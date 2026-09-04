import packageInfo from "../../package.json";

export const APP_INFO = {
  name: "Object Builder",
  tagline: "Native OTClient object and sprite editor",
  version: packageInfo.version,
  license: packageInfo.license,
  repository: packageInfo.repository,
  documentation: `${packageInfo.repository}#readme`,
  frontend: `React ${packageInfo.dependencies.react.replace("^", "")}`,
  tauri: packageInfo.dependencies["@tauri-apps/api"].replace("^", ""),
} as const;
