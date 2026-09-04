import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ScrollText,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { tr, useT } from "../../lib/i18n";
import { useLogStore, writeLog } from "../../stores/log-store";
import { Tooltip } from "../ui/tooltip";

const levelValues = ["ALL", "ERROR", "WARNING", "INFO", "SPRITE"];
export function LogPanel() {
  const t = useT();
  const { entries, expanded, setExpanded, clear } = useLogStore();
  const [level, setLevel] = useState("ALL");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const levels = levelValues.map((value) => ({ value, label: t(value) }));
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (level === "ALL" || entry.level === level) &&
          (!query ||
            `${entry.message} ${entry.context ?? ""} ${entry.details ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [entries, level, query],
  );
  useEffect(() => {
    if (expanded && autoFollow) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [autoFollow, entries, expanded]);
  const copy = async () => {
    const text = filtered
      .map(
        (entry) =>
          `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.level.padEnd(8)} ${entry.message}${entry.context ? ` · ${entry.context}` : ""}${entry.details ? `\n${entry.details}` : ""}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      writeLog("ERROR", tr("Unable to copy logs"), undefined, String(error));
    }
  };
  const errors = entries.filter((entry) => entry.level === "ERROR").length;
  const toggleLabel = expanded ? t("Collapse logs") : t("Expand logs");
  return (
    <section className={`log-panel ${expanded ? "expanded" : "collapsed"}`}>
      <header className="log-header">
        <div className="log-heading">
          <Tooltip label={toggleLabel} description={t("Shows or hides the application event log.")}>
            <Button
              className="log-toggle"
              variant="ghost"
              size="icon"
              aria-expanded={expanded}
              aria-controls="application-log-content"
              aria-label={toggleLabel}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </Button>
          </Tooltip>
          <span className="log-title">
            <ScrollText size={14} />
            <strong>{t("Logs")}</strong>
            <span>{t("{count} events", { count: entries.length })}</span>
            {errors > 0 && <em>{t("{count} errors", { count: errors })}</em>}
          </span>
        </div>
        {expanded && (
          <div className="log-actions">
            <div className="log-search">
              <Search size={12} />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search logs…")}
              />
            </div>
            <Select
              value={level}
              onValueChange={setLevel}
              options={levels}
              ariaLabel={t("Log level")}
            />
            <Tooltip
              label={t("Auto-follow logs")}
              description={t("Keeps the newest matching event visible as logs arrive.")}
            >
              <Button
                variant="ghost"
                size="icon"
                className={autoFollow ? "tool-active" : ""}
                onClick={() => setAutoFollow(!autoFollow)}
                aria-label={t("Toggle automatic log following")}
              >
                <ArrowDownToLine size={13} />
              </Button>
            </Tooltip>
            <Tooltip
              label={t("Copy logs")}
              description={t("Copies the currently filtered log entries and details.")}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void copy()}
                aria-label={t("Copy filtered logs")}
              >
                <Clipboard size={13} />
              </Button>
            </Tooltip>
            <Tooltip
              label={t("Clear logs")}
              description={t("Clears retained UI log entries without affecting project data.")}
            >
              <Button variant="ghost" size="icon" onClick={clear} aria-label={t("Clear logs")}>
                <Trash2 size={13} />
              </Button>
            </Tooltip>
          </div>
        )}
      </header>
      {expanded && (
        <div id="application-log-content" className="log-table">
          <div className="log-columns">
            <span>{t("Time")}</span>
            <span>{t("Level")}</span>
            <span>{t("Message")}</span>
            <span>{t("Source")}</span>
          </div>
          <div className="log-rows">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                className={`log-entry level-${entry.level.toLowerCase()}`}
                onClick={() => setDetails(details === entry.id ? null : entry.id)}
              >
                <time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time>
                <b>{t(entry.level)}</b>
                <span>
                  {entry.message}
                  {entry.context && <small>{entry.context}</small>}
                  {details === entry.id && entry.details && <code>{entry.details}</code>}
                </span>
                <i>{entry.source === "Rust" ? <Check size={11} /> : "UI"}</i>
              </button>
            ))}
            {!filtered.length && (
              <div className="log-empty">{t("No log entries match the current filters.")}</div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}
    </section>
  );
}
