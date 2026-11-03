import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FileArchive, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { NumberInput } from "../../components/ui/number-input";
import { Progress } from "../../components/ui/progress";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { useT } from "../../lib/i18n";
import { flushCoreMutations } from "../../stores/history-store";
import type { ObjectKind } from "../../types/editor";
import { formatEta } from "./OptimizeDialog";

interface WebExportProgress {
  processed: number;
  total: number;
  images: number;
  errors: number;
  imagesPerSecond: number;
  etaSeconds: number | null;
}

interface WebExportResult {
  objects: number;
  images: number;
  errors: number;
  failures: string[];
  elapsedMs: number;
  destination: string;
}

const KINDS: Array<{ kind: ObjectKind; label: string; folder: string }> = [
  { kind: "Outfit", label: "Outfits", folder: "outfits/walking, outfits/idle" },
  { kind: "Item", label: "Items", folder: "items" },
  { kind: "Effect", label: "Effects", folder: "effects" },
  { kind: "Missile", label: "Missiles", folder: "missiles" },
];

const newExportId = () =>
  globalThis.crypto?.randomUUID?.() ?? `web-export-${Date.now()}-${Math.random()}`;

export function WebExportDialog({
  open: isOpen,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [kinds, setKinds] = useState<ObjectKind[]>(KINDS.map((entry) => entry.kind));
  const [archive, setArchive] = useState(false);
  const [destination, setDestination] = useState("");
  const [compressLevel, setCompressLevel] = useState(1);
  const [threads, setThreads] = useState(1);
  const [defaultThreads, setDefaultThreads] = useState(1);
  const [progress, setProgress] = useState<WebExportProgress | null>(null);
  const [result, setResult] = useState<WebExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const exportId = useRef<string | null>(null);
  const running = progress !== null && result === null && error === null;

  useEffect(() => {
    let active = true;
    invoke<number>("web_export_default_threads")
      .then((value) => {
        if (!active) return;
        setDefaultThreads(value);
        setThreads(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (exportId.current)
        void invoke("cancel_web_export", { exportId: exportId.current }).catch(() => undefined);
    },
    [],
  );

  const toggleKind = (kind: ObjectKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind],
    );

  const chooseArchive = (value: boolean) => {
    setArchive(value);
    setDestination("");
  };

  const browse = async () => {
    const path = archive
      ? await save({
          title: t("Export web template as zip"),
          defaultPath: "web-template.zip",
          filters: [{ name: t("Zip archive"), extensions: ["zip"] }],
        })
      : await open({ directory: true, title: t("Export web template to folder") });
    if (typeof path !== "string") return;
    setDestination(archive && !path.toLowerCase().endsWith(".zip") ? `${path}.zip` : path);
  };

  const start = async () => {
    const id = newExportId();
    exportId.current = id;
    setResult(null);
    setError(null);
    setCancelling(false);
    setProgress({
      processed: 0,
      total: 0,
      images: 0,
      errors: 0,
      imagesPerSecond: 0,
      etaSeconds: null,
    });
    const channel = new Channel<WebExportProgress>();
    channel.onmessage = (value) => {
      if (exportId.current === id) setProgress(value);
    };
    try {
      await flushCoreMutations();
      const outcome = await invoke<WebExportResult>("export_web_template", {
        request: {
          kinds: KINDS.map((entry) => entry.kind).filter((kind) => kinds.includes(kind)),
          destination,
          archive,
          compressLevel,
          threads,
        },
        exportId: id,
        onProgress: channel,
      });
      if (exportId.current !== id) return;
      setResult(outcome);
    } catch (reason) {
      if (exportId.current !== id) return;
      const cancelled =
        typeof reason === "object" &&
        reason !== null &&
        (reason as { kind?: string }).kind === "operationCancelled";
      setError(
        cancelled
          ? t("Export cancelled")
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason),
      );
    } finally {
      if (exportId.current === id) exportId.current = null;
    }
  };

  const cancel = () => {
    if (!exportId.current) return;
    setCancelling(true);
    void invoke("cancel_web_export", { exportId: exportId.current }).catch(() => undefined);
  };

  const close = (next: boolean) => {
    if (!next && running) cancel();
    onOpenChange(next);
  };

  const percent = progress?.total ? (progress.processed / progress.total) * 100 : 0;

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent
        title={t("Export web template")}
        description={t(
          "Renders every object of the chosen types to PNG, in the folder layout of otclient-outfitter that the site reads.",
        )}
        className="web-export-dialog"
      >
        <div className="web-export-body">
          <section>
            <strong>{t("Object types")}</strong>
            <div className="web-export-kinds">
              {KINDS.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  aria-pressed={kinds.includes(entry.kind)}
                  disabled={running}
                  onClick={() => toggleKind(entry.kind)}
                >
                  <span>{t(entry.label)}</span>
                  <small>{entry.folder}/</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <strong>{t("Destination")}</strong>
            <RadioGroup
              className="web-export-target"
              value={archive ? "zip" : "folder"}
              onValueChange={(value) => chooseArchive(value === "zip")}
              disabled={running}
            >
              <label>
                <RadioGroupItem value="folder" />
                <FolderOpen size={13} />
                {t("Folder")}
              </label>
              <label>
                <RadioGroupItem value="zip" />
                <FileArchive size={13} />
                {t("Zip file")}
              </label>
            </RadioGroup>
            <div className="web-export-path">
              <span title={destination}>
                {destination || (archive ? t("No zip file chosen") : t("No folder chosen"))}
              </span>
              <Button variant="outline" size="sm" disabled={running} onClick={() => void browse()}>
                {t("Browse…")}
              </Button>
            </div>
          </section>
          <section className="web-export-numbers">
            <label>
              <span>
                <strong>{t("PNG compression")}</strong>
                <small>{t("0 is fastest and largest, 9 is slowest and smallest.")}</small>
              </span>
              <NumberInput
                value={compressLevel}
                onCommit={setCompressLevel}
                min={0}
                max={9}
                ariaLabel={t("PNG compression")}
              />
            </label>
            <label>
              <span>
                <strong>{t("Threads")}</strong>
                <small>
                  {t("Default: half of the logical cores ({count}).", { count: defaultThreads })}
                </small>
              </span>
              <NumberInput
                value={threads}
                onCommit={setThreads}
                min={1}
                max={256}
                ariaLabel={t("Threads")}
              />
            </label>
          </section>
          {progress && (
            <section className="web-export-progress">
              <Progress value={result ? 100 : percent} />
              <footer>
                <span>
                  {t("{processed} of {total} objects · {images} images", {
                    processed: progress.processed.toLocaleString(),
                    total: progress.total.toLocaleString(),
                    images: progress.images.toLocaleString(),
                  })}
                  {progress.imagesPerSecond > 0 &&
                    ` · ${t("{rate} img/s", { rate: Math.round(progress.imagesPerSecond) })}`}
                </span>
                <span>
                  {cancelling && running
                    ? t("Cancelling…")
                    : running
                      ? formatEta(t, progress.etaSeconds)
                      : null}
                </span>
              </footer>
              {progress.errors > 0 && (
                <small className="web-export-errors">
                  {t("{count} objects failed to render", { count: progress.errors })}
                </small>
              )}
            </section>
          )}
          {result && (
            <section className="web-export-result">
              <strong>
                {t("{images} images from {objects} objects in {seconds}s", {
                  images: result.images.toLocaleString(),
                  objects: result.objects.toLocaleString(),
                  seconds: (result.elapsedMs / 1000).toFixed(1),
                })}
              </strong>
              <small title={result.destination}>{result.destination}</small>
              {result.failures.length > 0 && (
                <ul>
                  {result.failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {error && <p className="web-export-errors">{error}</p>}
        </div>
        <footer className="dialog-footer">
          {running ? (
            <Button variant="ghost" disabled={cancelling} onClick={cancel}>
              {t("Cancel export")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => close(false)}>
              {t(result ? "Close" : "Cancel")}
            </Button>
          )}
          <Button
            disabled={running || !destination || kinds.length === 0}
            onClick={() => void start()}
          >
            {running ? t("Exporting…") : t("Export")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
