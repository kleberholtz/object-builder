use super::{lock_workspace, resolved_sprite, OptimizationRegistration};
use crate::{
    core::{
        dimensions::frame_group_dimensions,
        error::{ObjectBuilderError, Result},
        logging::emit_log,
        models::{ObjectKind, ThingObject},
    },
    sprites::{render_object_frame, render_object_layer, SpriteImage, SpriteReader, SpriteSource},
    state::AppState,
};
use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ExtendedColorType, ImageEncoder,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, State};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const EMIT_INTERVAL: Duration = Duration::from_millis(100);
const REPORTED_FAILURES: usize = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebExportRequest {
    pub kinds: Vec<ObjectKind>,
    pub destination: String,
    pub archive: bool,
    pub compress_level: u8,
    pub threads: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebExportProgress {
    pub processed: usize,
    pub total: usize,
    pub images: usize,
    pub errors: usize,
    pub images_per_second: f64,
    pub eta_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebExportResult {
    pub objects: usize,
    pub images: usize,
    pub errors: usize,
    pub failures: Vec<String>,
    pub elapsed_ms: u64,
    pub destination: String,
}

#[tauri::command]
pub fn web_export_default_threads() -> usize {
    thread::available_parallelism()
        .map(|count| count.get() / 2)
        .unwrap_or(2)
        .max(1)
}

#[tauri::command]
pub fn cancel_web_export(state: State<'_, AppState>, export_id: String) -> Result<bool> {
    let exports = state.2.lock().map_err(|_| {
        ObjectBuilderError::CorruptedFile("export registry lock was poisoned".into())
    })?;
    Ok(exports.get(&export_id).is_some_and(|flag| {
        flag.store(true, Ordering::Relaxed);
        true
    }))
}

#[tauri::command]
pub async fn export_web_template(
    app: AppHandle,
    state: State<'_, AppState>,
    request: WebExportRequest,
    export_id: String,
    on_progress: Channel<WebExportProgress>,
) -> Result<WebExportResult> {
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .2
        .lock()
        .map_err(|_| ObjectBuilderError::CorruptedFile("export registry lock was poisoned".into()))?
        .insert(export_id.clone(), cancellation.clone());
    let _registration = OptimizationRegistration {
        analyses: &state.2,
        analysis_id: export_id,
    };
    let (objects, overrides, source, sprite_size) = {
        let workspace = lock_workspace(&state)?;
        let mut objects = workspace
            .database
            .objects
            .iter()
            .filter(|object| request.kinds.contains(&object.kind))
            .cloned()
            .collect::<Vec<_>>();
        objects.sort_by_key(|object| {
            let rank = request.kinds.iter().position(|kind| *kind == object.kind);
            (rank, object.id)
        });
        (
            objects,
            workspace.sprite_overrides.clone(),
            workspace.sprite_source.clone(),
            workspace
                .sprite_source
                .as_ref()
                .map(|source| source.sprite_size)
                .unwrap_or(32),
        )
    };
    let destination = request.destination.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_export(
            &request,
            &objects,
            &overrides,
            source.as_ref(),
            sprite_size,
            &cancellation,
            &on_progress,
        )
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    emit_log(
        &app,
        if result.errors > 0 { "WARNING" } else { "INFO" },
        format!(
            "Web template exported: {} images from {} objects, {} errors",
            result.images, result.objects, result.errors
        ),
        Some(destination),
        (!result.failures.is_empty()).then(|| result.failures.join("\n")),
    );
    Ok(result)
}

struct WebImage {
    paths: Vec<String>,
    image: SpriteImage,
}

struct Counters {
    processed: AtomicUsize,
    images: AtomicUsize,
    errors: AtomicUsize,
    failures: Mutex<Vec<String>>,
    last_emit: Mutex<Instant>,
}

fn run_export(
    request: &WebExportRequest,
    objects: &[ThingObject],
    overrides: &HashMap<u32, SpriteImage>,
    source: Option<&SpriteSource>,
    sprite_size: u16,
    cancellation: &AtomicBool,
    progress: &Channel<WebExportProgress>,
) -> Result<WebExportResult> {
    let started = Instant::now();
    let compression = match request.compress_level.min(9) {
        0 => CompressionType::Uncompressed,
        level => CompressionType::Level(level),
    };
    let threads = request.threads.clamp(1, objects.len().max(1));
    let next = AtomicUsize::new(0);
    let counters = Counters {
        processed: AtomicUsize::new(0),
        images: AtomicUsize::new(0),
        errors: AtomicUsize::new(0),
        failures: Mutex::new(Vec::new()),
        last_emit: Mutex::new(started),
    };
    let report = |force: bool| {
        let Ok(mut last) = counters.last_emit.lock() else {
            return;
        };
        if !force && last.elapsed() < EMIT_INTERVAL {
            return;
        }
        *last = Instant::now();
        let processed = counters.processed.load(Ordering::Relaxed);
        let images = counters.images.load(Ordering::Relaxed);
        let elapsed = started.elapsed().as_secs_f64();
        let _ = progress.send(WebExportProgress {
            processed,
            total: objects.len(),
            images,
            errors: counters.errors.load(Ordering::Relaxed),
            images_per_second: if elapsed > 0.0 {
                images as f64 / elapsed
            } else {
                0.0
            },
            eta_seconds: (processed > 0 && elapsed > 0.5).then(|| {
                ((objects.len() - processed) as f64 * elapsed / processed as f64).ceil() as u64
            }),
        });
    };
    report(true);

    let work = |sink: &(dyn Fn(&str, &[u8]) -> Result<()> + Sync)| -> Result<()> {
        let mut reader = source.map(SpriteReader::open).transpose()?;
        loop {
            if cancellation.load(Ordering::Relaxed) {
                return Err(ObjectBuilderError::OperationCancelled("web export".into()));
            }
            let index = next.fetch_add(1, Ordering::Relaxed);
            let Some(object) = objects.get(index) else {
                return Ok(());
            };
            let mut cache = HashMap::<u32, SpriteImage>::new();
            let resolve = |id: u32| -> Result<SpriteImage> {
                if let Some(image) = cache.get(&id) {
                    return Ok(image.clone());
                }
                let image = match (overrides.contains_key(&id), reader.as_mut()) {
                    (false, Some(reader)) => reader.read(id)?,
                    _ => resolved_sprite(overrides, source, id)?,
                };
                cache.insert(id, image.clone());
                Ok(image)
            };
            let outcome = render_web_images(object, sprite_size, resolve).and_then(|images| {
                let mut written = 0;
                for entry in images {
                    let bytes = encode_png(&entry.image, compression)?;
                    for path in &entry.paths {
                        sink(path, &bytes)?;
                        written += 1;
                    }
                }
                Ok(written)
            });
            match outcome {
                Ok(written) => {
                    counters.images.fetch_add(written, Ordering::Relaxed);
                }
                Err(error) => {
                    counters.errors.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut failures) = counters.failures.lock() {
                        if failures.len() < REPORTED_FAILURES {
                            failures.push(format!("{:?} #{}: {error}", object.kind, object.id));
                        }
                    }
                }
            }
            counters.processed.fetch_add(1, Ordering::Relaxed);
            report(false);
        }
    };

    let destination = PathBuf::from(&request.destination);
    if request.archive {
        let partial = destination.with_extension("zip.part");
        let outcome = write_archive(&partial, threads, &work);
        match outcome {
            Ok(()) => fs::rename(&partial, &destination)?,
            Err(error) => {
                let _ = fs::remove_file(&partial);
                return Err(error);
            }
        }
    } else {
        let created = Mutex::new(HashSet::<PathBuf>::new());
        let sink = |path: &str, bytes: &[u8]| -> Result<()> {
            let target = destination.join(path);
            if let Some(parent) = target.parent() {
                let known = created
                    .lock()
                    .map(|set| set.contains(parent))
                    .unwrap_or(false);
                if !known {
                    fs::create_dir_all(parent)?;
                    if let Ok(mut set) = created.lock() {
                        set.insert(parent.to_path_buf());
                    }
                }
            }
            fs::write(target, bytes)?;
            Ok(())
        };
        run_workers(threads, || work(&sink))?;
    }
    report(true);
    Ok(WebExportResult {
        objects: objects.len(),
        images: counters.images.load(Ordering::Relaxed),
        errors: counters.errors.load(Ordering::Relaxed),
        failures: counters.failures.into_inner().unwrap_or_default(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        destination: request.destination.clone(),
    })
}

fn run_workers<F>(threads: usize, work: F) -> Result<()>
where
    F: Fn() -> Result<()> + Sync,
{
    thread::scope(|scope| {
        let handles = (0..threads).map(|_| scope.spawn(&work)).collect::<Vec<_>>();
        handles.into_iter().try_for_each(|handle| {
            handle
                .join()
                .map_err(|_| ObjectBuilderError::IoError("export worker panicked".into()))?
        })
    })
}

fn write_archive<W>(path: &Path, threads: usize, work: &W) -> Result<()>
where
    W: Fn(&(dyn Fn(&str, &[u8]) -> Result<()> + Sync)) -> Result<()> + Sync,
{
    let mut archive = ZipWriter::new(std::io::BufWriter::new(fs::File::create(path)?));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let (sender, receiver) = mpsc::sync_channel::<(String, Vec<u8>)>(threads * 8);
    thread::scope(|scope| -> Result<()> {
        let writer = scope.spawn(move || -> Result<()> {
            for (name, bytes) in receiver {
                archive.start_file(name, options).map_err(zip_error)?;
                archive.write_all(&bytes)?;
            }
            archive.finish().map_err(zip_error)?.flush()?;
            Ok(())
        });
        let sink = |name: &str, bytes: &[u8]| -> Result<()> {
            sender
                .send((name.to_owned(), bytes.to_vec()))
                .map_err(|_| ObjectBuilderError::IoError("archive writer stopped".into()))
        };
        let rendered = run_workers(threads, || work(&sink));
        drop(sender);
        let written = writer
            .join()
            .map_err(|_| ObjectBuilderError::IoError("archive writer panicked".into()))?;
        rendered.and(written)
    })
}

fn zip_error(error: zip::result::ZipError) -> ObjectBuilderError {
    ObjectBuilderError::IoError(format!("unable to write zip: {error}"))
}

fn encode_png(image: &SpriteImage, compression: CompressionType) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, compression, FilterType::Adaptive)
        .write_image(
            &image.rgba,
            image.width,
            image.height,
            ExtendedColorType::Rgba8,
        )
        .map_err(|error| ObjectBuilderError::IoError(format!("unable to encode PNG: {error}")))?;
    Ok(bytes)
}

fn idle_group(object: &ThingObject) -> Option<usize> {
    let groups = &object.frame_groups;
    groups
        .iter()
        .position(|group| group.layout.group_type == 0)
        .or((!groups.is_empty()).then_some(0))
}

fn group_patterns(object: &ThingObject, group_index: usize) -> (usize, usize, usize) {
    let layout = object.frame_groups[group_index].layout;
    if layout.width == 0 || layout.height == 0 || layout.layers == 0 {
        return (usize::from(object.dimensions.patterns.max(1)), 1, 1);
    }
    (
        usize::from(layout.pattern_x.max(1)),
        usize::from(layout.pattern_y.max(1)),
        usize::from(layout.pattern_z.max(1)),
    )
}

fn render_web_images<F>(
    object: &ThingObject,
    sprite_size: u16,
    mut resolve: F,
) -> Result<Vec<WebImage>>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let Some(idle) = idle_group(object) else {
        return Ok(Vec::new());
    };
    let id = object.id;
    let single = |path: String, image: SpriteImage| WebImage {
        paths: vec![path],
        image,
    };
    let mut images = Vec::new();
    match object.kind {
        ObjectKind::Outfit => {
            let moving = object
                .frame_groups
                .iter()
                .position(|group| group.layout.group_type == 1);
            let walking = moving.unwrap_or(idle);
            let walking_frames = render_outfit_group(object, walking, sprite_size, &mut resolve)?;
            if moving.is_none() || moving == Some(idle) {
                for (name, image) in walking_frames {
                    images.push(WebImage {
                        paths: vec![
                            format!("outfits/walking/{id}/{name}.png"),
                            format!("outfits/idle/{id}/{name}.png"),
                        ],
                        image,
                    });
                }
            } else {
                for (name, image) in walking_frames {
                    images.push(single(format!("outfits/walking/{id}/{name}.png"), image));
                }
                for (name, image) in render_outfit_group(object, idle, sprite_size, &mut resolve)? {
                    images.push(single(format!("outfits/idle/{id}/{name}.png"), image));
                }
            }
        }
        ObjectKind::Item => {
            let (pattern_x, pattern_y, _) = group_patterns(object, idle);
            let stackable = object.flags.get("Stackable").copied().unwrap_or(false);
            let frames = if stackable && pattern_x == 4 && pattern_y == 2 {
                (0..pattern_x * pattern_y)
                    .map(|pattern| {
                        render_object_frame(object, idle, 0, pattern, sprite_size, &mut resolve)
                    })
                    .collect::<Result<Vec<_>>>()?
            } else {
                (0..object.frame_groups[idle].frames.len())
                    .map(|frame| {
                        render_object_frame(object, idle, frame, 0, sprite_size, &mut resolve)
                    })
                    .collect::<Result<Vec<_>>>()?
            };
            for (index, image) in frames.into_iter().enumerate() {
                images.push(single(format!("items/{id}_{index}.png"), image));
            }
        }
        ObjectKind::Effect => {
            for frame in 0..object.frame_groups[idle].frames.len() {
                let image =
                    render_object_layer(object, idle, frame, 0, 0, sprite_size, &mut resolve)?;
                images.push(single(format!("effects/{id}_{frame}.png"), image));
            }
        }
        ObjectKind::Missile => {
            let (pattern_x, pattern_y, _) = group_patterns(object, idle);
            let frames = object.frame_groups[idle].frames.len();
            let mut index = 0;
            for x in 0..pattern_x {
                for y in 0..pattern_y {
                    for frame in 0..frames {
                        let pattern = y * pattern_x + x;
                        let image = render_object_layer(
                            object,
                            idle,
                            frame,
                            pattern,
                            0,
                            sprite_size,
                            &mut resolve,
                        )?;
                        images.push(single(format!("missiles/{id}_{index}.png"), image));
                        index += 1;
                    }
                }
            }
        }
        ObjectKind::Unknown => {}
    }
    Ok(images)
}

fn render_outfit_group<F>(
    object: &ThingObject,
    group_index: usize,
    sprite_size: u16,
    resolve: &mut F,
) -> Result<Vec<(String, SpriteImage)>>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let (pattern_x, pattern_y, pattern_z) = group_patterns(object, group_index);
    let layers = usize::from(
        frame_group_dimensions(object, group_index, sprite_size)
            .layers
            .clamp(1, 2),
    );
    let frames = object.frame_groups[group_index].frames.len();
    let mut images = Vec::new();
    for z in 0..pattern_z {
        for y in 0..pattern_y {
            for x in 0..pattern_x {
                let pattern = (z * pattern_y + y) * pattern_x + x;
                for layer in 0..layers {
                    let suffix = if layer == 1 { "_template" } else { "" };
                    for frame in 0..frames {
                        let image = render_object_layer(
                            object,
                            group_index,
                            frame,
                            pattern,
                            layer,
                            sprite_size,
                            &mut *resolve,
                        )?;
                        images.push((
                            format!("{}_{}_{}_{}{suffix}", frame + 1, z + 1, y + 1, x + 1),
                            image,
                        ));
                    }
                }
            }
        }
    }
    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{test_object, Frame, FrameGroup, FrameLayout};

    fn group(group_type: u8, layers: u8, patterns: (u8, u8, u8), frames: usize) -> FrameGroup {
        let (pattern_x, pattern_y, pattern_z) = patterns;
        let count = frames
            * usize::from(layers)
            * usize::from(pattern_x)
            * usize::from(pattern_y)
            * usize::from(pattern_z);
        FrameGroup {
            id: format!("group-{group_type}"),
            name: String::new(),
            looped: true,
            frames: (0..frames)
                .map(|index| Frame {
                    id: index as u64,
                    sprite_id: 1,
                    duration: 100,
                })
                .collect(),
            sprite_ids: (1..=count as u32).collect(),
            layout: FrameLayout {
                group_type,
                width: 1,
                height: 1,
                layers,
                pattern_x,
                pattern_y,
                pattern_z,
            },
        }
    }

    fn object(kind: ObjectKind, groups: Vec<FrameGroup>) -> ThingObject {
        let mut object = test_object();
        object.kind = kind;
        object.frame_groups = groups;
        object
    }

    fn render(object: &ThingObject) -> Vec<(Vec<String>, u8)> {
        render_web_images(object, 32, |id| {
            let mut rgba = vec![0; 32 * 32 * 4];
            rgba[0] = id as u8;
            rgba[3] = 255;
            SpriteImage::new(32, 32, rgba)
        })
        .expect("render")
        .into_iter()
        .map(|entry| (entry.paths, entry.image.rgba[0]))
        .collect()
    }

    #[test]
    fn outfit_without_moving_group_writes_the_same_frames_to_walking_and_idle() {
        let outfit = object(ObjectKind::Outfit, vec![group(0, 2, (4, 1, 1), 1)]);
        let images = render(&outfit);
        assert_eq!(images.len(), 8);
        assert_eq!(
            images[0].0,
            vec![
                "outfits/walking/100/1_1_1_1.png",
                "outfits/idle/100/1_1_1_1.png"
            ]
        );
        assert_eq!(images[1].0[0], "outfits/walking/100/1_1_1_1_template.png");
        assert_eq!(images[2].0[0], "outfits/walking/100/1_1_1_2.png");
    }

    #[test]
    fn outfit_with_both_groups_renders_each_into_its_folder() {
        let outfit = object(
            ObjectKind::Outfit,
            vec![group(0, 1, (4, 1, 1), 1), group(1, 1, (4, 1, 1), 2)],
        );
        let images = render(&outfit);
        let walking = images
            .iter()
            .filter(|(paths, _)| paths[0].starts_with("outfits/walking/"))
            .count();
        let idle = images
            .iter()
            .filter(|(paths, _)| paths[0].starts_with("outfits/idle/"))
            .count();
        assert_eq!((walking, idle), (8, 4));
        assert!(images.iter().all(|(paths, _)| paths.len() == 1));
        assert!(images
            .iter()
            .any(|(paths, _)| paths[0] == "outfits/walking/100/2_1_1_4.png"));
    }

    #[test]
    fn stackable_item_exports_its_eight_count_patterns() {
        let mut item = object(ObjectKind::Item, vec![group(0, 1, (4, 2, 1), 1)]);
        item.flags.insert("Stackable".into(), true);
        let images = render(&item);
        let names = images
            .iter()
            .map(|(paths, _)| paths[0].as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 8);
        assert_eq!(names[0], "items/100_0.png");
        assert_eq!(names[7], "items/100_7.png");
        assert_eq!(images[5].1, 6);
    }

    #[test]
    fn missile_numbers_directions_with_x_outermost() {
        let missile = object(ObjectKind::Missile, vec![group(0, 1, (3, 3, 1), 1)]);
        let images = render(&missile);
        assert_eq!(images.len(), 9);
        assert_eq!(images[1].0[0], "missiles/100_1.png");
        assert_eq!(images[1].1, 4);
    }

    fn run(archive: bool, destination: &Path) -> WebExportResult {
        let objects = (1..=6)
            .map(|id| {
                let mut effect = object(ObjectKind::Effect, vec![group(0, 1, (1, 1, 1), 2)]);
                effect.id = id;
                effect
            })
            .collect::<Vec<_>>();
        let overrides = (1..=2)
            .map(|id| {
                (
                    id,
                    SpriteImage::new(32, 32, vec![id as u8; 32 * 32 * 4]).unwrap(),
                )
            })
            .collect::<HashMap<_, _>>();
        let request = WebExportRequest {
            kinds: vec![ObjectKind::Effect],
            destination: destination.display().to_string(),
            archive,
            compress_level: 1,
            threads: 3,
        };
        run_export(
            &request,
            &objects,
            &overrides,
            None,
            32,
            &AtomicBool::new(false),
            &Channel::new(|_| Ok(())),
        )
        .expect("export")
    }

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("web-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn folder_export_writes_every_frame() {
        let root = scratch("folder");
        let result = run(false, &root);
        assert_eq!((result.objects, result.images, result.errors), (6, 12, 0));
        assert!(root.join("effects/6_1.png").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn zip_export_lands_under_the_requested_name() {
        let root = scratch("zip");
        let target = root.join("template.zip");
        let result = run(true, &target);
        assert_eq!(result.images, 12);
        assert!(!root.join("template.zip.part").exists());
        let archive = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        assert_eq!(archive.len(), 12);
        assert!(archive
            .file_names()
            .any(|name| name.is_ok_and(|name| name == "effects/3_0.png")));
        let _ = fs::remove_dir_all(root);
    }
}
