import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Download,
  Droplets,
  Info,
  LogOut,
  Pencil,
  Plus,
  Search,
  Sparkles,
  SprayCan,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, googleProvider, db, firebaseConfigured } from "./firebase";
import seedData from "./seedData.json";

const STORAGE_KEY = "cologne_inventory_v1";

const uid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const normalize = (v) => (v ?? "").toString().trim();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const round1 = (x) => Number(Number(x).toFixed(1));

const safeJsonParse = (s, fallback) => {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/* ─── AI auto-fill (Gemini via serverless function) ─── */
const aiAutofill = async ({ brand, name }) => {
  const res = await fetch("/api/autofill-fragrance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand, name }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `Auto-fill failed (${res.status})`);
  }
  const json = await res.json();
  if (!json || json.ok !== true || !json.data) throw new Error("Auto-fill returned no data");
  return json.data;
};

const defaultData = () => ({
  version: 1,
  settings: { currency: "USD" },
  fragrances: [],
  bottles: [],
  wears: [],
});

const migrateData = (d) => {
  const next = { ...d };
  if (!Array.isArray(next.fragrances)) next.fragrances = [];
  if (!Array.isArray(next.bottles)) next.bottles = [];
  if (!Array.isArray(next.wears)) next.wears = [];
  if (!next.settings || typeof next.settings !== "object") next.settings = { currency: "USD" };
  return next;
};

const loadData = () => {
  if (typeof window === "undefined") return defaultData();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== "object") return defaultData();
  return migrateData({ ...defaultData(), ...parsed });
};

/* ─── Firestore sync ─── */
const loadFromFirestore = async (userId) => {
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
};

const saveToFirestore = async (userId, data) => {
  if (!db) return;
  try {
    await setDoc(doc(db, "users", userId), data);
  } catch (e) {
    console.error("Firestore save error:", e);
  }
};

const useDebouncedEffect = (fn, deps, delay) => {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const t = setTimeout(() => fnRef.current(), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

const formatMoney = (n, currency = "USD") => {
  const v = Number(n);
  if (!Number.isFinite(v)) return typeof n === "string" && n ? n : "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
};

const formatDate = (ts) => {
  const t = Number(ts);
  if (!Number.isFinite(t)) return "—";
  try {
    return new Date(t).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(t).toISOString();
  }
};

const csvEscape = (v) => {
  const s = (v ?? "").toString();
  if (s.includes(",") || s.includes("\n") || s.includes('"')) return '"' + s.replaceAll('"', '""') + '"';
  return s;
};

const downloadText = (filename, content, type = "text/plain") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result || "");
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });

const STATUS_OPTIONS = [
  { value: "IN_STOCK", label: "In Stock" },
  { value: "FINISHED", label: "Finished" },
  { value: "SOLD", label: "Sold" },
  { value: "TRADED", label: "Traded" },
];
const statusLabel = (s) => STATUS_OPTIONS.find((o) => o.value === s)?.label || s;
const statusTone = (s) => (s === "IN_STOCK" ? "good" : s === "FINISHED" ? "neutral" : "warn");

const ACCORD_OPTIONS = [
  "Citrus", "Fresh", "Aquatic", "Green", "Aromatic", "Fougère", "Woody", "Oud",
  "Leather", "Smoky", "Incense", "Spicy", "Sweet", "Gourmand", "Vanilla", "Tobacco",
  "Boozy", "Amber", "Musky", "Powdery", "Floral", "Rose", "Fruity", "Coconut",
];

const OCCASION_OPTIONS = [
  "Office", "Casual", "Date night", "Night out", "Formal event", "Gym", "Outdoors",
  "Beach/Vacation", "Cozy night in", "Special occasion",
];

/* ─── UI primitives ─── */
function Pill({ children, tone = "neutral" }) {
  const map = {
    neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
    brand: "bg-indigo-50 text-indigo-700 border-indigo-200",
    good: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        map[tone] || map.neutral
      }`}
    >
      {children}
    </span>
  );
}

function Button({ children, onClick, icon: Icon, variant = "secondary", disabled, type = "button" }) {
  const styles =
    variant === "primary"
      ? "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800"
      : variant === "danger"
      ? "bg-red-600 text-white border-red-600 hover:bg-red-500"
      : variant === "ghost"
      ? "bg-transparent text-zinc-800 border-zinc-200 hover:bg-zinc-50"
      : "bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-50";
  return (
    <button
      type={type}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.99] ${styles} ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

function Input({ value, onChange, placeholder, icon: Icon, type = "text" }) {
  return (
    <div className="relative">
      {Icon ? <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /> : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className={`w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 ${
          Icon ? "pl-9" : ""
        }`}
      />
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300"
    />
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-zinc-700">{label}</div>
      {children}
    </div>
  );
}

function Modal({ open, title, children, onClose, footer }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            style={{ maxHeight: "85vh" }}
            initial={{ y: 16, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.98, opacity: 0 }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-5">
              <div className="text-lg font-bold text-zinc-900">{title}</div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-700 hover:bg-zinc-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer ? <div className="shrink-0 border-t border-zinc-100 p-5">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function InstallToHomeScreenBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("ios_install_banner_dismissed") === "1";
    } catch {
      return false;
    }
  });

  const { show } = useMemo(() => {
    if (typeof window === "undefined") return { show: false };
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isChromeiOS = /CriOS/i.test(ua);
    const isFirefoxiOS = /FxiOS/i.test(ua);
    const isEdgeiOS = /EdgiOS/i.test(ua);
    const isSafari = isIOS && !isChromeiOS && !isFirefoxiOS && !isEdgeiOS;
    const standalone =
      (typeof navigator !== "undefined" && "standalone" in navigator && navigator.standalone) ||
      (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
    return { show: isSafari && !standalone };
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-indigo-50 p-2">
              <Info className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">Install on your iPhone (no App Store)</div>
              <div className="mt-1 text-xs text-zinc-600">
                Open in <span className="font-medium">Safari</span>, then tap <span className="font-medium">Share</span> →{" "}
                <span className="font-medium">Add to Home Screen</span>.
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              icon={X}
              onClick={() => {
                setDismissed(true);
                try {
                  localStorage.setItem("ios_install_banner_dismissed", "1");
                } catch {
                  // ignore
                }
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ query, setQuery, onAdd, onExportCsv, onImportClick, onBackupJson, user, onSignOut }) {
  return (
    <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-zinc-900 text-white shadow">
              <SprayCan className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-extrabold text-zinc-900">Cologne Inventory</div>
              <div className="text-xs text-zinc-500">{user?.displayName || user?.email || "Local only"}</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="ghost" icon={Upload} onClick={onImportClick}>
              Import
            </Button>
            <Button variant="ghost" icon={Download} onClick={onExportCsv}>
              Export
            </Button>
            <Button variant="ghost" icon={Download} onClick={onBackupJson}>
              Backup JSON
            </Button>
            <Button variant="secondary" icon={Plus} onClick={onAdd}>
              Add
            </Button>
            {user ? (
              <Button variant="ghost" icon={LogOut} onClick={onSignOut}>
                Sign Out
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <Input value={query} onChange={setQuery} placeholder="Search fragrances, brands, notes, sellers…" icon={Search} />
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <Button variant="ghost" icon={Upload} onClick={onImportClick}>
              Import
            </Button>
            <Button variant="ghost" icon={Download} onClick={onExportCsv}>
              Export
            </Button>
            <Button variant="secondary" icon={Plus} onClick={onAdd}>
              Add
            </Button>
            {user ? <Button variant="ghost" icon={LogOut} onClick={onSignOut} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Table({ columns, rows, empty, onRowClick, sort, onSortChange }) {
  const sortedRows = useMemo(() => {
    if (!sort?.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || typeof col.sortValue !== "function") return rows;
    const dir = sort.dir === "desc" ? -1 : 1;

    const cmp = (a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return -1;
      if (b == null) return 1;
      const na = typeof a === "number" ? a : Number(a);
      const nb = typeof b === "number" ? b : Number(b);
      const aNum = Number.isFinite(na);
      const bNum = Number.isFinite(nb);
      if (aNum && bNum) return na - nb;
      return String(a).localeCompare(String(b));
    };

    return [...rows].sort((ra, rb) => cmp(col.sortValue(ra), col.sortValue(rb)) * dir);
  }, [rows, sort?.key, sort?.dir, columns]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              {columns.map((c) => {
                const sortable = typeof c.sortValue === "function" && typeof onSortChange === "function";
                const active = sortable && sort?.key === c.key;
                const arrow = active ? (sort?.dir === "desc" ? "▼" : "▲") : "";
                return (
                  <th key={c.key} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold text-zinc-700">
                    {sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-zinc-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSortChange(c.key);
                        }}
                      >
                        <span>{c.header}</span>
                        <span className="text-[10px] text-zinc-500">{arrow}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sortedRows.length ? (
              sortedRows.map((r) => (
                <tr
                  key={r.key}
                  className={`hover:bg-zinc-50 ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-4 py-3 text-sm text-zinc-800">
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={columns.length}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stars({ value, onChange }) {
  const v = clamp(Number(value || 0), 0, 5);
  const set = (n) => {
    if (!onChange) return;
    onChange(clamp(Number(n), 0, 5));
  };

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = v >= i + 1;
        const half = !filled && v > i && v < i + 1;
        return (
          <div key={i} className={`relative h-4 w-4 ${onChange ? "cursor-pointer" : ""}`}>
            <Star
              className={`h-4 w-4 ${filled ? "text-amber-500" : half ? "text-amber-300" : "text-zinc-300"}`}
              fill={filled || half ? "currentColor" : "none"}
            />
            {onChange ? (
              <>
                <button
                  type="button"
                  className="absolute inset-y-0 left-0 w-1/2 opacity-0"
                  aria-label={`Rate ${i + 0.5}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    set(i + 0.5);
                  }}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 w-1/2 opacity-0"
                  aria-label={`Rate ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    set(i + 1);
                  }}
                />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RatingRow({ label, value, onChange }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-zinc-600">{label}</div>
          <div className="mt-1 flex items-center gap-2">
            <Stars value={value} onChange={onChange} />
            <div className="text-sm font-semibold tabular-nums text-zinc-900">{Number(value).toFixed(1)}</div>
          </div>
        </div>
        <div className="w-48">
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value), 0, 5))}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

function TagPicker({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50"
            }`}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

function SearchableFragranceSelect({ fragrances, value, onChange }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sorted = useMemo(
    () =>
      [...fragrances]
        .map((f) => ({ id: f.id, label: `${f.brand} • ${f.name}${f.og ? ` • (${f.og})` : ""}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [fragrances]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((f) => f.label.toLowerCase().includes(q));
  }, [sorted, search]);

  const selected = sorted.find((f) => f.id === value);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-300"
        placeholder="Search fragrances…"
        value={isOpen ? search : selected?.label || ""}
        onFocus={() => {
          setIsOpen(true);
          setSearch("");
        }}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">No matches</div>
          ) : (
            filtered.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 ${f.id === value ? "bg-zinc-50 font-semibold" : ""}`}
                onClick={() => {
                  onChange(f.id);
                  setIsOpen(false);
                  setSearch("");
                }}
              >
                {f.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const emptyFragranceDraft = () => ({
  brand: "",
  name: "",
  og: "",
  topNotes: "",
  middleNotes: "",
  baseNotes: "",
  gender: "",
  seasons: "",
  occasions: "",
  confidence: "",
});

function FragranceFormFields({ draft, setDraft, autofillState, onAutofill }) {
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Brand *">
          <Input value={draft.brand} onChange={set("brand")} placeholder="Lattafa" />
        </Field>
        <Field label="Name *">
          <Input value={draft.name} onChange={set("name")} placeholder="Khamrah Dukhan" />
        </Field>
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-indigo-900">AI auto-fill</div>
            <div className="mt-0.5 text-xs text-indigo-700">
              Fills inspired-by, note pyramid, gender, seasons & occasions from the brand + name.
            </div>
          </div>
          <Button
            variant="primary"
            icon={Sparkles}
            disabled={!normalize(draft.brand) || !normalize(draft.name) || autofillState.loading}
            onClick={onAutofill}
          >
            {autofillState.loading ? "Filling…" : "Auto-fill"}
          </Button>
        </div>
        {autofillState.error ? <div className="mt-2 text-xs font-medium text-red-600">{autofillState.error}</div> : null}
        {autofillState.done ? (
          <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Filled — review before saving
          </div>
        ) : null}
      </div>

      <Field label="Inspired by / Original (OG)">
        <Input value={draft.og} onChange={set("og")} placeholder="Parfums de Marly Layton, or 'Lattafa original'" />
      </Field>
      <Field label="Top notes">
        <Input value={draft.topNotes} onChange={set("topNotes")} placeholder="Bergamot, Pink Pepper, Cardamom" />
      </Field>
      <Field label="Middle notes">
        <Input value={draft.middleNotes} onChange={set("middleNotes")} placeholder="Lavender, Guava, Ginger" />
      </Field>
      <Field label="Base notes">
        <Input value={draft.baseNotes} onChange={set("baseNotes")} placeholder="Sandalwood, Incense, Amber" />
      </Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Gender lean">
          <Select
            value={draft.gender}
            onChange={set("gender")}
            options={[
              { value: "", label: "—" },
              { value: "Masculine", label: "Masculine" },
              { value: "Feminine", label: "Feminine" },
              { value: "Unisex", label: "Unisex" },
              { value: "Unisex (masculine-leaning)", label: "Unisex (masc-leaning)" },
              { value: "Unisex (feminine-leaning)", label: "Unisex (fem-leaning)" },
            ]}
          />
        </Field>
        <Field label="Seasons">
          <Input value={draft.seasons} onChange={set("seasons")} placeholder="Fall/Winter" />
        </Field>
        <Field label="Confidence">
          <Select
            value={draft.confidence}
            onChange={set("confidence")}
            options={[
              { value: "", label: "—" },
              { value: "High", label: "High" },
              { value: "Medium", label: "Medium" },
              { value: "Low", label: "Low" },
            ]}
          />
        </Field>
      </div>
      <Field label="Occasions">
        <Input value={draft.occasions} onChange={set("occasions")} placeholder="Date night, evenings out" />
      </Field>
    </div>
  );
}

function useAutofill(draft, setDraft) {
  const [state, setState] = useState({ loading: false, error: "", done: false });
  const run = useCallback(async () => {
    setState({ loading: true, error: "", done: false });
    try {
      const data = await aiAutofill({ brand: draft.brand, name: draft.name });
      setDraft((d) => ({
        ...d,
        og: normalize(data.og) || d.og,
        topNotes: normalize(data.topNotes) || d.topNotes,
        middleNotes: normalize(data.middleNotes) || d.middleNotes,
        baseNotes: normalize(data.baseNotes) || d.baseNotes,
        gender: normalize(data.gender) || d.gender,
        seasons: normalize(data.seasons) || d.seasons,
        occasions: normalize(data.occasions) || d.occasions,
        confidence: normalize(data.confidence) || d.confidence,
        _suggestedSizeMl: data.sizeMl || d._suggestedSizeMl,
      }));
      setState({ loading: false, error: "", done: true });
    } catch (e) {
      setState({ loading: false, error: e.message || "Auto-fill failed", done: false });
    }
  }, [draft.brand, draft.name, setDraft]);
  return [state, run];
}

function AddBottleModal({ open, onClose, fragrances, onSave }) {
  const [mode, setMode] = useState("existing");
  const [fragranceId, setFragranceId] = useState("");
  const [draft, setDraft] = useState(emptyFragranceDraft);
  const [sizeMl, setSizeMl] = useState("100");
  const [pricePaid, setPricePaid] = useState("");
  const [fillLevel, setFillLevel] = useState(100);
  const [purchasedFrom, setPurchasedFrom] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [autofillState, runAutofill] = useAutofill(draft, setDraft);

  useEffect(() => {
    if (!open) return;
    setMode(fragrances.length ? "existing" : "new");
    setFragranceId("");
    setDraft(emptyFragranceDraft());
    setSizeMl("100");
    setPricePaid("");
    setFillLevel(100);
    setPurchasedFrom("");
    setPurchaseDate("");
    setNotes("");
  }, [open, fragrances.length]);

  useEffect(() => {
    if (draft._suggestedSizeMl && (!sizeMl || sizeMl === "100")) setSizeMl(String(draft._suggestedSizeMl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft._suggestedSizeMl]);

  const canSave = mode === "existing" ? Boolean(fragranceId) : Boolean(normalize(draft.brand) && normalize(draft.name));

  return (
    <Modal
      open={open}
      title="Add Bottle"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            disabled={!canSave}
            onClick={() => {
              onSave({
                mode,
                fragranceId,
                fragranceDraft: draft,
                bottle: {
                  sizeMl: Number(sizeMl) || null,
                  pricePaid: pricePaid === "" ? "" : Number.isFinite(Number(pricePaid)) ? Number(pricePaid) : pricePaid,
                  fillLevel: clamp(Number(fillLevel) || 0, 0, 100),
                  purchasedFrom: normalize(purchasedFrom),
                  purchaseDate: normalize(purchaseDate),
                  notes: normalize(notes),
                },
              });
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "existing", label: "Existing fragrance" },
            { value: "new", label: "New fragrance" },
          ]}
        />

        {mode === "existing" ? (
          <Field label="Fragrance *">
            <SearchableFragranceSelect fragrances={fragrances} value={fragranceId} onChange={setFragranceId} />
          </Field>
        ) : (
          <FragranceFormFields draft={draft} setDraft={setDraft} autofillState={autofillState} onAutofill={runAutofill} />
        )}

        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="mb-3 text-sm font-bold text-zinc-800">Bottle</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Size (mL)">
              <Input value={sizeMl} onChange={setSizeMl} type="number" placeholder="100" />
            </Field>
            <Field label="Price paid ($)">
              <Input value={pricePaid} onChange={setPricePaid} placeholder="35 (or 'free' / 'trade')" />
            </Field>
            <Field label={`Fill level: ${fillLevel}%`}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={fillLevel}
                onChange={(e) => setFillLevel(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Purchased from">
              <Input value={purchasedFrom} onChange={setPurchasedFrom} placeholder="u/seller, Jomashop, trade…" />
            </Field>
            <Field label="Purchase date">
              <Input value={purchaseDate} onChange={setPurchaseDate} placeholder="MM/DD/YYYY" />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Notes">
              <TextArea value={notes} onChange={setNotes} placeholder="Batch code, condition, box, deal details…" rows={2} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EditFragranceModal({ open, fragrance, onClose, onSave }) {
  const [draft, setDraft] = useState(emptyFragranceDraft);
  const [autofillState, runAutofill] = useAutofill(draft, setDraft);

  useEffect(() => {
    if (!open || !fragrance) return;
    setDraft({ ...emptyFragranceDraft(), ...fragrance });
  }, [open, fragrance]);

  return (
    <Modal
      open={open}
      title="Edit Fragrance"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Check}
            disabled={!normalize(draft.brand) || !normalize(draft.name)}
            onClick={() => {
              onSave({ ...fragrance, ...draft });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <FragranceFormFields draft={draft} setDraft={setDraft} autofillState={autofillState} onAutofill={runAutofill} />
    </Modal>
  );
}

function EditBottleModal({ open, bottle, onClose, onSave }) {
  const [sizeMl, setSizeMl] = useState("");
  const [pricePaid, setPricePaid] = useState("");
  const [fillLevel, setFillLevel] = useState(100);
  const [status, setStatus] = useState("IN_STOCK");
  const [purchasedFrom, setPurchasedFrom] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !bottle) return;
    setSizeMl(bottle.sizeMl != null ? String(bottle.sizeMl) : "");
    setPricePaid(bottle.pricePaid === 0 || bottle.pricePaid ? String(bottle.pricePaid) : "");
    setFillLevel(clamp(Number(bottle.fillLevel ?? 100), 0, 100));
    setStatus(bottle.status || "IN_STOCK");
    setPurchasedFrom(bottle.purchasedFrom || "");
    setPurchaseDate(bottle.purchaseDate || "");
    setNotes(bottle.notes || "");
  }, [open, bottle]);

  return (
    <Modal
      open={open}
      title="Edit Bottle"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Check}
            onClick={() => {
              onSave({
                ...bottle,
                sizeMl: Number(sizeMl) || null,
                pricePaid: pricePaid === "" ? "" : Number.isFinite(Number(pricePaid)) ? Number(pricePaid) : pricePaid,
                fillLevel: clamp(Number(fillLevel) || 0, 0, 100),
                status,
                purchasedFrom: normalize(purchasedFrom),
                purchaseDate: normalize(purchaseDate),
                notes: normalize(notes),
                updatedAt: Date.now(),
              });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Size (mL)">
            <Input value={sizeMl} onChange={setSizeMl} type="number" />
          </Field>
          <Field label="Price paid ($)">
            <Input value={pricePaid} onChange={setPricePaid} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
        </div>
        <Field label={`Fill level: ${fillLevel}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={fillLevel}
            onChange={(e) => setFillLevel(Number(e.target.value))}
            className="w-full"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Purchased from">
            <Input value={purchasedFrom} onChange={setPurchasedFrom} />
          </Field>
          <Field label="Purchase date">
            <Input value={purchaseDate} onChange={setPurchaseDate} placeholder="MM/DD/YYYY" />
          </Field>
        </div>
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function WearModal({ open, bottle, fragrance, initialEntry, onClose, onSave }) {
  const [scent, setScent] = useState(4.0);
  const [longevity, setLongevity] = useState(4.0);
  const [projection, setProjection] = useState(4.0);
  const [versatility, setVersatility] = useState(4.0);
  const [sprays, setSprays] = useState(4);
  const [occasion, setOccasion] = useState("");
  const [accords, setAccords] = useState([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initialEntry) {
      const r = initialEntry.ratings || {};
      setScent(clamp(Number(r.scent ?? 4.0), 0, 5));
      setLongevity(clamp(Number(r.longevity ?? 4.0), 0, 5));
      setProjection(clamp(Number(r.projection ?? 4.0), 0, 5));
      setVersatility(clamp(Number(r.versatility ?? 4.0), 0, 5));
      setSprays(clamp(Number(initialEntry.sprays ?? 4), 0, 30));
      setOccasion(initialEntry.occasion || "");
      setAccords(Array.isArray(initialEntry.accords) ? [...initialEntry.accords] : []);
      setNotes(initialEntry.notes || "");
      return;
    }
    setScent(4.0);
    setLongevity(4.0);
    setProjection(4.0);
    setVersatility(4.0);
    setSprays(4);
    setOccasion("");
    setAccords([]);
    setNotes("");
  }, [open, initialEntry]);

  const overall = useMemo(() => round1((scent + longevity + projection + versatility) / 4), [scent, longevity, projection, versatility]);

  return (
    <Modal
      open={open}
      title="Wear Log"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Pill tone="brand">
            <Star className="h-3 w-3" /> {overall.toFixed(1)}/5
          </Pill>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Droplets}
              disabled={!bottle}
              onClick={() => {
                if (!bottle) return;
                onSave({
                  bottleId: bottle.id,
                  entryId: initialEntry?.id || null,
                  overall,
                  ratings: {
                    scent: round1(scent),
                    longevity: round1(longevity),
                    projection: round1(projection),
                    versatility: round1(versatility),
                  },
                  sprays: clamp(Number(sprays) || 0, 0, 30),
                  occasion: normalize(occasion),
                  accords,
                  notes: normalize(notes),
                });
                onClose();
              }}
            >
              {initialEntry ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-xs font-semibold text-zinc-600">Fragrance</div>
          <div className="mt-1 text-base font-extrabold text-zinc-900">
            {fragrance?.brand || "—"} • {fragrance?.name || "—"}
          </div>
          <div className="mt-1 text-xs text-zinc-600">
            {fragrance?.og ? `Inspired by ${fragrance.og} • ` : ""}
            {bottle?.sizeMl ? `${bottle.sizeMl} mL • ` : ""}
            fill {bottle?.fillLevel ?? 100}%
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <RatingRow label="Scent" value={scent} onChange={setScent} />
          <RatingRow label="Longevity" value={longevity} onChange={setLongevity} />
          <RatingRow label="Projection" value={projection} onChange={setProjection} />
          <RatingRow label="Versatility" value={versatility} onChange={setVersatility} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Sprays">
            <Input value={String(sprays)} onChange={(v) => setSprays(clamp(Number(v || 0), 0, 30))} type="number" placeholder="4" />
          </Field>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-xs font-semibold text-zinc-600">Overall</div>
            <div className="mt-2 flex items-center gap-2">
              <Stars value={overall} />
              <div className="text-lg font-extrabold tabular-nums text-zinc-900">{overall.toFixed(1)}/5</div>
            </div>
          </div>
        </div>

        <Field label="Occasion">
          <div className="flex flex-wrap gap-1.5">
            {OCCASION_OPTIONS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOccasion(occasion === o ? "" : o)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  occasion === o
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Accords noticed">
          <TagPicker options={ACCORD_OPTIONS} selected={accords} onToggle={(t) => setAccords((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))} />
        </Field>

        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} placeholder="Performance, compliments, weather, how it developed…" rows={4} />
        </Field>
      </div>
    </Modal>
  );
}

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError(e.message || "Sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-lg">
        <div className="text-3xl font-extrabold tracking-tight text-zinc-900">Cologne Inventory</div>
        <div className="mt-2 text-sm text-zinc-500">Sign in to sync your collection across devices</div>
        <button
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <svg className="h-5 w-5" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.08 24.08 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(firebaseConfigured ? undefined : null); // undefined = loading
  const [data, setData] = useState(() => loadData());
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [tab, setTab] = useState("inventory");
  const [invFilter, setInvFilter] = useState("IN_STOCK");
  const [query, setQuery] = useState("");
  const [invSort, setInvSort] = useState({ key: "fragrance", dir: "asc" });
  const [catSort, setCatSort] = useState({ key: "fragrance", dir: "asc" });

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [wearModal, setWearModal] = useState({ open: false, bottleId: null, entryId: null });
  const [detailsModal, setDetailsModal] = useState({ open: false, kind: "bottle", id: null });
  const [editFragrance, setEditFragrance] = useState(null);
  const [editBottle, setEditBottle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, kind: "", id: null, label: "" });

  const importInputRef = useRef(null);

  /* ─── Auth listener ─── */
  useEffect(() => {
    if (!firebaseConfigured) return;
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const fsData = await loadFromFirestore(firebaseUser.uid);
          if (fsData) {
            setData(migrateData({ ...defaultData(), ...fsData }));
          } else {
            const localData = loadData();
            setData(localData);
            await saveToFirestore(firebaseUser.uid, localData);
          }
        } catch (e) {
          console.error("Firestore init error:", e);
          setData(loadData());
        }
        setFirestoreReady(true);
        setUser(firebaseUser);
      } else {
        setFirestoreReady(false);
        setUser(null);
      }
    });
    return unsub;
  }, []);

  /* ─── Save to localStorage + Firestore on change ─── */
  useDebouncedEffect(
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
      if (user && firestoreReady) {
        saveToFirestore(user.uid, data);
      }
    },
    [data],
    500
  );

  const fragrancesById = useMemo(() => new Map(data.fragrances.map((f) => [f.id, f])), [data.fragrances]);
  const bottlesById = useMemo(() => new Map(data.bottles.map((b) => [b.id, b])), [data.bottles]);

  const wearsByBottleId = useMemo(() => {
    const m = new Map();
    for (const w of data.wears) {
      if (!w?.bottleId) continue;
      if (!m.has(w.bottleId)) m.set(w.bottleId, []);
      m.get(w.bottleId).push(w);
    }
    return m;
  }, [data.wears]);

  const avgRatingByFragranceId = useMemo(() => {
    const sums = new Map();
    for (const w of data.wears) {
      const b = bottlesById.get(w.bottleId);
      if (!b) continue;
      const cur = sums.get(b.fragranceId) || { total: 0, n: 0 };
      cur.total += Number(w.overall || 0);
      cur.n += 1;
      sums.set(b.fragranceId, cur);
    }
    const m = new Map();
    for (const [fid, { total, n }] of sums) m.set(fid, round1(total / n));
    return m;
  }, [data.wears, bottlesById]);

  const q = normalize(query).toLowerCase();

  const filteredBottles = useMemo(() => {
    if (!q) return data.bottles;
    return data.bottles.filter((b) => {
      const f = fragrancesById.get(b.fragranceId);
      const hay = [f?.brand, f?.name, f?.og, f?.topNotes, f?.middleNotes, f?.baseNotes, f?.seasons, b.purchasedFrom, b.status, b.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [q, data.bottles, fragrancesById]);

  const filteredFragrances = useMemo(() => {
    if (!q) return data.fragrances;
    return data.fragrances.filter((f) => {
      const hay = [f.brand, f.name, f.og, f.topNotes, f.middleNotes, f.baseNotes, f.gender, f.seasons, f.occasions]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [q, data.fragrances]);

  const inStockCount = useMemo(() => data.bottles.filter((b) => b.status === "IN_STOCK").length, [data.bottles]);
  const inventoryValue = useMemo(
    () =>
      data.bottles
        .filter((b) => b.status === "IN_STOCK")
        .reduce((acc, b) => acc + (Number.isFinite(Number(b.pricePaid)) ? Number(b.pricePaid) : 0), 0),
    [data.bottles]
  );

  /* ─── Import / export ─── */
  const openImport = () => importInputRef.current?.click();

  const exportCsv = () => {
    const headers = [
      "Brand", "Name", "Inspired_By", "Top_Notes", "Middle_Notes", "Base_Notes", "Gender", "Seasons",
      "Occasions", "Size_mL", "Price_Paid", "Fill_Level", "Status", "Purchased_From", "Purchase_Date", "Notes",
    ];
    const rows = data.bottles.map((b) => {
      const f = fragrancesById.get(b.fragranceId);
      return [
        f?.brand || "", f?.name || "", f?.og || "", f?.topNotes || "", f?.middleNotes || "", f?.baseNotes || "",
        f?.gender || "", f?.seasons || "", f?.occasions || "", b.sizeMl ?? "", b.pricePaid ?? "", b.fillLevel ?? "",
        b.status || "", b.purchasedFrom || "", b.purchaseDate || "", b.notes || "",
      ];
    });
    const csv = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
    downloadText(`cologne_inventory_${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  };

  const backupJson = () => {
    downloadText(`cologne_inventory_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
  };

  const importJson = async (file) => {
    const txt = await readFileAsText(file);
    const parsed = safeJsonParse(txt, null);
    if (!parsed || typeof parsed !== "object") return;
    setData(migrateData({ ...defaultData(), ...parsed }));
  };

  const loadSeed = () => {
    const now = Date.now();
    setData((d) => ({
      ...d,
      fragrances: seedData.fragrances.map((f) => ({ ...f, createdAt: now, updatedAt: now })),
      bottles: seedData.bottles.map((b) => ({ ...b, createdAt: now, updatedAt: now })),
    }));
  };

  /* ─── Mutations ─── */
  const upsertFragrance = (f) => {
    const next = { ...f };
    if (!next.id) next.id = uid();
    for (const k of ["brand", "name", "og", "topNotes", "middleNotes", "baseNotes", "gender", "seasons", "occasions", "confidence"]) {
      next[k] = normalize(next[k]);
    }
    delete next._suggestedSizeMl;
    next.updatedAt = Date.now();
    setData((d) => {
      const exists = d.fragrances.some((x) => x.id === next.id);
      const fragrances = exists ? d.fragrances.map((x) => (x.id === next.id ? { ...x, ...next } : x)) : [next, ...d.fragrances];
      return { ...d, fragrances };
    });
    return next.id;
  };

  const onAddFlowSave = ({ mode, fragranceId, fragranceDraft, bottle }) => {
    let fid = fragranceId;
    if (mode === "new") {
      fid = upsertFragrance({ id: "", ...fragranceDraft, createdAt: Date.now() });
    }
    if (!fid) return;
    setData((d) => ({
      ...d,
      bottles: [
        {
          id: uid(),
          fragranceId: fid,
          status: "IN_STOCK",
          ...bottle,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ...d.bottles,
      ],
    }));
    setAddModalOpen(false);
    setTab("inventory");
  };

  const saveBottle = (b) => {
    setData((d) => ({ ...d, bottles: d.bottles.map((x) => (x.id === b.id ? b : x)) }));
  };

  const addOrUpdateWear = ({ bottleId, entryId, overall, ratings, sprays, occasion, accords, notes }) => {
    const now = Date.now();
    const base = {
      bottleId,
      overall: round1(clamp(Number(overall || 0), 0, 5)),
      ratings: {
        scent: round1(clamp(Number(ratings.scent || 0), 0, 5)),
        longevity: round1(clamp(Number(ratings.longevity || 0), 0, 5)),
        projection: round1(clamp(Number(ratings.projection || 0), 0, 5)),
        versatility: round1(clamp(Number(ratings.versatility || 0), 0, 5)),
      },
      sprays: clamp(Number(sprays || 0), 0, 30),
      occasion: normalize(occasion),
      accords: Array.isArray(accords) ? accords : [],
      notes: normalize(notes),
    };
    if (entryId) {
      setData((d) => ({ ...d, wears: d.wears.map((w) => (w.id === entryId ? { ...w, ...base, updatedAt: now } : w)) }));
      return;
    }
    setData((d) => ({ ...d, wears: [{ id: uid(), ...base, createdAt: now, updatedAt: now }, ...d.wears] }));
  };

  const doDelete = () => {
    const { kind, id } = confirmDelete;
    setConfirmDelete({ open: false, kind: "", id: null, label: "" });
    if (kind === "bottle") {
      setData((d) => {
        const bottles = d.bottles.filter((b) => b.id !== id);
        const wears = d.wears.filter((w) => w.bottleId !== id);
        const usedFragranceIds = new Set(bottles.map((b) => b.fragranceId));
        const fragrances = d.fragrances.filter((f) => usedFragranceIds.has(f.id));
        return { ...d, bottles, wears, fragrances };
      });
      setDetailsModal({ open: false, kind: "bottle", id: null });
    }
    if (kind === "fragrance") {
      setData((d) => {
        const fragrances = d.fragrances.filter((f) => f.id !== id);
        const removedBottleIds = new Set(d.bottles.filter((b) => b.fragranceId === id).map((b) => b.id));
        const bottles = d.bottles.filter((b) => b.fragranceId !== id);
        const wears = d.wears.filter((w) => !removedBottleIds.has(w.bottleId));
        return { ...d, fragrances, bottles, wears };
      });
      setDetailsModal({ open: false, kind: "fragrance", id: null });
    }
    if (kind === "wear") {
      setData((d) => ({ ...d, wears: d.wears.filter((w) => w.id !== id) }));
    }
  };

  const openWear = (bottleId, entryId = null) => setWearModal({ open: true, bottleId, entryId });

  const currentWearBottle = wearModal.bottleId ? bottlesById.get(wearModal.bottleId) : null;
  const currentWearFragrance = currentWearBottle ? fragrancesById.get(currentWearBottle.fragranceId) : null;
  const currentWearEntry = wearModal.entryId ? data.wears.find((w) => w.id === wearModal.entryId) : null;

  const toggleSort = (setter) => (key) =>
    setter((s) => (s.key === key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (firebaseConfigured && user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">Loading…</div>
    );
  }
  if (firebaseConfigured && user === null) {
    return <LoginScreen />;
  }

  /* ─── Views ─── */
  const InventoryView = () => {
    const viewBottles =
      invFilter === "ALL" ? filteredBottles : filteredBottles.filter((b) => (invFilter === "IN_STOCK" ? b.status === "IN_STOCK" : b.status !== "IN_STOCK"));

    const rows = viewBottles.map((b) => {
      const f = fragrancesById.get(b.fragranceId);
      const wears = wearsByBottleId.get(b.id) || [];
      const lastWear = wears[0];
      return { key: b.id, bottle: b, fragrance: f, wearCount: wears.length, lastWear };
    });

    const columns = [
      {
        key: "fragrance",
        header: "Fragrance",
        sortValue: (r) => `${r.fragrance?.brand || ""} ${r.fragrance?.name || ""}`,
        cell: (r) => (
          <div>
            <div className="font-semibold text-zinc-900">{r.fragrance?.name || "—"}</div>
            <div className="text-xs text-zinc-500">{r.fragrance?.brand || "—"}</div>
          </div>
        ),
      },
      {
        key: "og",
        header: "Inspired by",
        sortValue: (r) => r.fragrance?.og || "",
        cell: (r) => <span className="text-xs text-zinc-600">{r.fragrance?.og || "—"}</span>,
      },
      {
        key: "size",
        header: "Size",
        sortValue: (r) => r.bottle.sizeMl ?? -1,
        cell: (r) => (r.bottle.sizeMl ? `${r.bottle.sizeMl} mL` : "—"),
      },
      {
        key: "fill",
        header: "Fill",
        sortValue: (r) => r.bottle.fillLevel ?? -1,
        cell: (r) => (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full rounded-full ${Number(r.bottle.fillLevel) > 25 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${clamp(Number(r.bottle.fillLevel ?? 100), 0, 100)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-zinc-600">{r.bottle.fillLevel ?? 100}%</span>
          </div>
        ),
      },
      {
        key: "price",
        header: "Paid",
        sortValue: (r) => (Number.isFinite(Number(r.bottle.pricePaid)) ? Number(r.bottle.pricePaid) : -1),
        cell: (r) => formatMoney(r.bottle.pricePaid, data.settings.currency),
      },
      {
        key: "from",
        header: "From",
        sortValue: (r) => r.bottle.purchasedFrom || "",
        cell: (r) => <span className="text-xs text-zinc-600">{r.bottle.purchasedFrom || "—"}</span>,
      },
      {
        key: "status",
        header: "Status",
        sortValue: (r) => r.bottle.status,
        cell: (r) => <Pill tone={statusTone(r.bottle.status)}>{statusLabel(r.bottle.status)}</Pill>,
      },
      {
        key: "rating",
        header: "Rating",
        sortValue: (r) => r.lastWear?.overall ?? -1,
        cell: (r) =>
          r.lastWear ? (
            <div className="flex items-center gap-1.5">
              <Stars value={r.lastWear.overall} />
              <span className="text-xs tabular-nums text-zinc-600">
                {Number(r.lastWear.overall).toFixed(1)} ({r.wearCount})
              </span>
            </div>
          ) : (
            <span className="text-xs text-zinc-400">Not rated</span>
          ),
      },
      {
        key: "actions",
        header: "",
        cell: (r) => (
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={Droplets} onClick={() => openWear(r.bottle.id)}>
              Wear
            </Button>
            <Button variant="ghost" icon={Pencil} onClick={() => setEditBottle(r.bottle)} />
          </div>
        ),
      },
    ];

    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={invFilter}
            onChange={setInvFilter}
            options={[
              { value: "IN_STOCK", label: `In Stock (${data.bottles.filter((b) => b.status === "IN_STOCK").length})` },
              { value: "GONE", label: `Gone (${data.bottles.filter((b) => b.status !== "IN_STOCK").length})` },
              { value: "ALL", label: `All (${data.bottles.length})` },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="neutral">{inStockCount} bottles in stock</Pill>
            <Pill tone="brand">{formatMoney(inventoryValue, data.settings.currency)} invested</Pill>
            <Pill tone="neutral">{data.wears.length} wears logged</Pill>
          </div>
        </div>

        {data.bottles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <div className="text-base font-bold text-zinc-900">No bottles yet</div>
            <div className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
              Add your first bottle, or load the starter collection imported from your spreadsheet (142 bottles with full notes).
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="primary" icon={Plus} onClick={() => setAddModalOpen(true)}>
                Add bottle
              </Button>
              <Button variant="secondary" icon={Sparkles} onClick={loadSeed}>
                Load my 142-bottle collection
              </Button>
            </div>
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            empty="No bottles match."
            sort={invSort}
            onSortChange={toggleSort(setInvSort)}
            onRowClick={(r) => setDetailsModal({ open: true, kind: "bottle", id: r.bottle.id })}
          />
        )}
      </div>
    );
  };

  const JournalView = () => {
    const entries = data.wears
      .filter((w) => {
        if (!q) return true;
        const b = bottlesById.get(w.bottleId);
        const f = b ? fragrancesById.get(b.fragranceId) : null;
        const hay = [f?.brand, f?.name, w.occasion, w.notes, ...(w.accords || [])].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return (
      <div className="grid gap-3">
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
            No wears logged yet. Hit <span className="font-semibold">Wear</span> on a bottle to start your journal.
          </div>
        ) : (
          entries.map((w) => {
            const b = bottlesById.get(w.bottleId);
            const f = b ? fragrancesById.get(b.fragranceId) : null;
            return (
              <div key={w.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-zinc-900">
                      {f ? `${f.brand} • ${f.name}` : "(deleted bottle)"}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {formatDate(w.createdAt)}
                      {w.occasion ? ` • ${w.occasion}` : ""}
                      {w.sprays ? ` • ${w.sprays} sprays` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone="brand">
                      <Star className="h-3 w-3" /> {Number(w.overall ?? 0).toFixed(1)}/5
                    </Pill>
                    <Button variant="ghost" icon={Pencil} onClick={() => openWear(w.bottleId, w.id)} />
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => setConfirmDelete({ open: true, kind: "wear", id: w.id, label: "this wear entry" })}
                    />
                  </div>
                </div>
                {w.ratings ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone="neutral">Scent {w.ratings.scent?.toFixed?.(1) ?? w.ratings.scent}</Pill>
                    <Pill tone="neutral">Longevity {w.ratings.longevity?.toFixed?.(1) ?? w.ratings.longevity}</Pill>
                    <Pill tone="neutral">Projection {w.ratings.projection?.toFixed?.(1) ?? w.ratings.projection}</Pill>
                    <Pill tone="neutral">Versatility {w.ratings.versatility?.toFixed?.(1) ?? w.ratings.versatility}</Pill>
                  </div>
                ) : null}
                {(w.accords || []).length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {w.accords.map((t) => (
                      <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                {w.notes ? <div className="mt-2 text-sm text-zinc-700">{w.notes}</div> : null}
              </div>
            );
          })
        )}
      </div>
    );
  };

  const CatalogView = () => {
    const rows = filteredFragrances.map((f) => {
      const bottles = data.bottles.filter((b) => b.fragranceId === f.id);
      return {
        key: f.id,
        fragrance: f,
        bottleCount: bottles.length,
        inStock: bottles.filter((b) => b.status === "IN_STOCK").length,
        avg: avgRatingByFragranceId.get(f.id),
      };
    });

    const columns = [
      {
        key: "fragrance",
        header: "Fragrance",
        sortValue: (r) => `${r.fragrance.brand} ${r.fragrance.name}`,
        cell: (r) => (
          <div>
            <div className="font-semibold text-zinc-900">{r.fragrance.name}</div>
            <div className="text-xs text-zinc-500">{r.fragrance.brand}</div>
          </div>
        ),
      },
      {
        key: "og",
        header: "Inspired by",
        sortValue: (r) => r.fragrance.og || "",
        cell: (r) => <span className="text-xs text-zinc-600">{r.fragrance.og || "—"}</span>,
      },
      {
        key: "seasons",
        header: "Seasons",
        sortValue: (r) => r.fragrance.seasons || "",
        cell: (r) => <span className="text-xs text-zinc-600">{r.fragrance.seasons || "—"}</span>,
      },
      {
        key: "gender",
        header: "Gender",
        sortValue: (r) => r.fragrance.gender || "",
        cell: (r) => <span className="text-xs text-zinc-600">{r.fragrance.gender || "—"}</span>,
      },
      {
        key: "bottles",
        header: "Bottles",
        sortValue: (r) => r.bottleCount,
        cell: (r) => (
          <span className="text-xs text-zinc-600">
            {r.inStock} in stock / {r.bottleCount}
          </span>
        ),
      },
      {
        key: "avg",
        header: "Avg rating",
        sortValue: (r) => r.avg ?? -1,
        cell: (r) =>
          r.avg != null ? (
            <div className="flex items-center gap-1.5">
              <Stars value={r.avg} />
              <span className="text-xs tabular-nums text-zinc-600">{r.avg.toFixed(1)}</span>
            </div>
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          ),
      },
      {
        key: "actions",
        header: "",
        cell: (r) => <Button variant="ghost" icon={Pencil} onClick={() => setEditFragrance(r.fragrance)} />,
      },
    ];

    return (
      <Table
        columns={columns}
        rows={rows}
        empty="No fragrances yet."
        sort={catSort}
        onSortChange={toggleSort(setCatSort)}
        onRowClick={(r) => setDetailsModal({ open: true, kind: "fragrance", id: r.fragrance.id })}
      />
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 pb-16">
      <TopBar
        query={query}
        setQuery={setQuery}
        onAdd={() => setAddModalOpen(true)}
        onExportCsv={exportCsv}
        onImportClick={openImport}
        onBackupJson={backupJson}
        user={user}
        onSignOut={() => signOut(auth)}
      />

      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          await importJson(file);
        }}
      />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <InstallToHomeScreenBanner />
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "inventory", label: "Inventory" },
              { value: "journal", label: `Journal (${data.wears.length})` },
              { value: "catalog", label: `Catalog (${data.fragrances.length})` },
            ]}
          />
        </div>

        {tab === "inventory" ? <InventoryView /> : null}
        {tab === "journal" ? <JournalView /> : null}
        {tab === "catalog" ? <CatalogView /> : null}
      </div>

      {/* ─── Details modal ─── */}
      <Modal
        open={detailsModal.open}
        title={detailsModal.kind === "fragrance" ? "Fragrance Details" : "Bottle Details"}
        onClose={() => setDetailsModal({ open: false, kind: "bottle", id: null })}
      >
        {(() => {
          if (!detailsModal.open) return null;

          if (detailsModal.kind === "fragrance") {
            const f = fragrancesById.get(detailsModal.id);
            if (!f) return <div className="text-sm text-zinc-600">Not found.</div>;
            const bottles = data.bottles.filter((b) => b.fragranceId === f.id);
            const fields = [
              ["Brand", f.brand],
              ["Name", f.name],
              ["Inspired by", f.og],
              ["Top notes", f.topNotes],
              ["Middle notes", f.middleNotes],
              ["Base notes", f.baseNotes],
              ["Gender", f.gender],
              ["Seasons", f.seasons],
              ["Occasions", f.occasions],
              ["Confidence", f.confidence],
            ];
            return (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <div className="text-lg font-extrabold text-zinc-900">{f.name}</div>
                  <div className="mt-1 text-sm text-zinc-600">{f.brand}</div>
                  <div className="mt-4 grid gap-2">
                    {fields.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-3 gap-3 text-sm">
                        <div className="col-span-1 font-semibold text-zinc-600">{k}</div>
                        <div className="col-span-2 text-zinc-900">{normalize(v) ? v : "—"}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill tone="neutral">{bottles.length} bottle{bottles.length === 1 ? "" : "s"}</Pill>
                    {avgRatingByFragranceId.get(f.id) != null ? (
                      <Pill tone="brand">
                        <Star className="h-3 w-3" /> {avgRatingByFragranceId.get(f.id).toFixed(1)}/5 avg
                      </Pill>
                    ) : null}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="secondary" icon={Pencil} onClick={() => setEditFragrance(f)}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      icon={Trash2}
                      onClick={() =>
                        setConfirmDelete({ open: true, kind: "fragrance", id: f.id, label: `${f.brand} ${f.name} (and its bottles + wear logs)` })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          const b = bottlesById.get(detailsModal.id);
          if (!b) return <div className="text-sm text-zinc-600">Not found.</div>;
          const f = fragrancesById.get(b.fragranceId);
          const wears = wearsByBottleId.get(b.id) || [];
          const fields = [
            ["Brand", f?.brand],
            ["Name", f?.name],
            ["Inspired by", f?.og],
            ["Top notes", f?.topNotes],
            ["Middle notes", f?.middleNotes],
            ["Base notes", f?.baseNotes],
            ["Gender", f?.gender],
            ["Seasons", f?.seasons],
            ["Occasions", f?.occasions],
            ["Size", b.sizeMl ? `${b.sizeMl} mL` : ""],
            ["Fill level", `${b.fillLevel ?? 100}%`],
            ["Price paid", formatMoney(b.pricePaid, data.settings.currency)],
            ["Purchased from", b.purchasedFrom],
            ["Purchase date", b.purchaseDate],
            ["Status", statusLabel(b.status)],
            ["Notes", b.notes],
          ];
          return (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-lg font-extrabold text-zinc-900">{f?.name || "Bottle"}</div>
                <div className="mt-1 text-sm text-zinc-600">{f?.brand || ""}</div>

                {wears.length ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone="brand">
                      <Star className="h-3 w-3" /> Last {Number(wears[0].overall ?? 0).toFixed(1)}/5
                    </Pill>
                    <Pill tone="neutral">{wears.length} wear{wears.length === 1 ? "" : "s"}</Pill>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-zinc-600">No wears logged yet.</div>
                )}

                <div className="mt-4 grid gap-2">
                  {fields.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-3 gap-3 text-sm">
                      <div className="col-span-1 font-semibold text-zinc-600">{k}</div>
                      <div className="col-span-2 text-zinc-900">{normalize(v) ? v : "—"}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="primary" icon={Droplets} onClick={() => openWear(b.id)}>
                    Log Wear
                  </Button>
                  <Button variant="secondary" icon={Pencil} onClick={() => setEditBottle(b)}>
                    Edit Bottle
                  </Button>
                  {f ? (
                    <Button variant="secondary" icon={Pencil} onClick={() => setEditFragrance(f)}>
                      Edit Fragrance
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setConfirmDelete({ open: true, kind: "bottle", id: b.id, label: `${f?.brand || ""} ${f?.name || "this bottle"}` })}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      <AddBottleModal open={addModalOpen} onClose={() => setAddModalOpen(false)} fragrances={data.fragrances} onSave={onAddFlowSave} />

      <EditFragranceModal open={Boolean(editFragrance)} fragrance={editFragrance} onClose={() => setEditFragrance(null)} onSave={upsertFragrance} />

      <EditBottleModal open={Boolean(editBottle)} bottle={editBottle} onClose={() => setEditBottle(null)} onSave={saveBottle} />

      <WearModal
        open={wearModal.open}
        bottle={currentWearBottle}
        fragrance={currentWearFragrance}
        initialEntry={currentWearEntry}
        onClose={() => setWearModal({ open: false, bottleId: null, entryId: null })}
        onSave={addOrUpdateWear}
      />

      <Modal
        open={confirmDelete.open}
        title="Confirm delete"
        onClose={() => setConfirmDelete({ open: false, kind: "", id: null, label: "" })}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete({ open: false, kind: "", id: null, label: "" })}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} onClick={doDelete}>
              Delete
            </Button>
          </div>
        }
      >
        <div className="text-sm text-zinc-700">
          You are about to delete <span className="font-semibold">{confirmDelete.label}</span>. This cannot be undone.
        </div>
      </Modal>
    </div>
  );
}
