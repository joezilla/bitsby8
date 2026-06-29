// FDC+ shared building blocks — exported to window so every screen can use them.

const { useState, useMemo, useEffect, useRef } = React;

/* ── tiny utilities ───────────────────────────────────────── */
const cx = (...a) => a.filter(Boolean).join(" ");

/* ── Icon (Material Symbols Rounded) ──────────────────────── */
function Icon({ name, filled, size = 20, className, style }) {
  const cls = cx(
    "icon",
    filled && "filled",
    size === 16 && "s-16",
    size === 18 && "s-18",
    size === 20 && "s-20",
    size === 24 && "s-24",
    className,
  );
  return <span className={cls} style={style}>{name}</span>;
}

/* ── LED pip ──────────────────────────────────────────────── */
function Led({ color = "off", pulse = false, md = false, label, sublabel }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className={cx("led", md && "led-md", `led-${color}`, pulse && "pulse")} />
      {label && (
        <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ font: "var(--text-label)", color: "var(--fg-2)" }}>{label}</span>
          {sublabel && (
            <span className="fdc-label-strip" style={{ fontSize: 9 }}>{sublabel}</span>
          )}
        </span>
      )}
    </span>
  );
}

/* ── Button ───────────────────────────────────────────────── */
function Btn({ variant = "outline", size, icon, iconFilled, children, danger, style, ...rest }) {
  return (
    <button
      className={cx("btn", variant, size, danger && "danger")}
      style={style}
      {...rest}
    >
      {icon && <Icon name={icon} filled={iconFilled} size={size === "sm" ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/* ── Chip ─────────────────────────────────────────────────── */
function Chip({ color, children, icon }) {
  return (
    <span className={cx("chip", color)}>
      {icon && <Icon name={icon} size={16} style={{ fontSize: 12 }} />}
      {children}
    </span>
  );
}

/* ── The Altair "label strip" header — a subtle vintage cue ─ */
function LabelStrip({ items }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 18,
        padding: "0 12px",
        gap: 16,
        background:
          "linear-gradient(180deg, var(--surface-variant), color-mix(in oklab, var(--surface-variant) 70%, var(--bg)))",
        borderBottom: "1px solid var(--border-1)",
        borderTop: "1px solid var(--border-1)",
      }}
    >
      {items.map((label, i) => (
        <span
          key={i}
          className="fdc-label-strip"
          style={{
            fontSize: 9,
            opacity: i === 0 ? 0.85 : 0.55,
            letterSpacing: "0.2em",
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/* ── Top header (the chrome that wraps every page) ────────── */
function Topbar({ activeName }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        height: 56,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border-1)",
        flex: "0 0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              fontSize: 20,
              letterSpacing: "0.04em",
              color: "var(--fg-1)",
            }}
          >
            FDC<span style={{ color: "var(--accent)" }}>+</span>
          </span>
          <span className="fdc-label-strip" style={{ opacity: 0.7 }}>
            Floppy Disk Controller · Mits Altair 8800
          </span>
        </div>
      </div>
      <HeaderStatus />
    </header>
  );
}

function HeaderStatus() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      {/* connection + serial + fdc */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Led color="green" label="Online" />
        <Led color="cyan" label="Serial" sublabel="230400" />
        <Led color="green" label="FDC" sublabel="serving" />
      </div>

      {/* divider */}
      <div style={{ width: 1, height: 22, background: "var(--border-1)" }} />

      {/* drive LEDs row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="fdc-label-strip">Drives</span>
        <DriveLed n={0} state="active" />
        <DriveLed n={1} state="mounted" />
        <DriveLed n={2} state="empty" />
        <DriveLed n={3} state="empty" />
      </div>

      {/* divider */}
      <div style={{ width: 1, height: 22, background: "var(--border-1)" }} />

      {/* terminal */}
      <Led color="cyan" label="Term" />

      {/* theme toggle (visual only here — wired in app.jsx) */}
      <button className="iconbtn" title="Toggle theme">
        <Icon name="dark_mode" size={18} />
      </button>
      <button className="iconbtn" title="Assistant">
        <Icon name="forum" size={18} />
      </button>
    </div>
  );
}

function DriveLed({ n, state }) {
  const map = {
    active:  { color: "amber", pulse: true },
    mounted: { color: "green", pulse: false },
    empty:   { color: "off",   pulse: false },
  };
  const m = map[state];
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
      }}
    >
      <span className={cx("led", `led-${m.color}`, m.pulse && "pulse")} />
      <span
        className="fdc-label-strip"
        style={{ fontSize: 8.5, letterSpacing: "0.1em" }}
      >
        {n}
      </span>
    </span>
  );
}

/* ── Sidebar nav ──────────────────────────────────────────── */
const NAV_ITEMS = [
  { id: "terminal",  label: "Terminal",  icon: "monitor",            badge: null },
  { id: "disks",     label: "Disks",     icon: "save",               badge: "2/4" },
  { id: "cassettes", label: "Cassettes", icon: "album",              badge: null },
  { id: "scripts",   label: "Scripts",   icon: "terminal",           badge: null },
  { id: "config",    label: "Config",    icon: "tune",               badge: null },
];

function Sidebar({ active }) {
  return (
    <nav
      style={{
        width: 220,
        flex: "0 0 220px",
        background: "var(--surface)",
        borderRight: "1px solid var(--border-1)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
      }}
    >
      <div style={{ padding: "0 16px 8px" }}>
        <span className="fdc-label-strip" style={{ fontSize: 9 }}>Navigation</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                background: isActive ? "var(--accent-bg)" : "transparent",
                border: "none",
                color: isActive ? "var(--accent)" : "var(--fg-2)",
                font: "var(--text-label)",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                textAlign: "left",
                position: "relative",
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: -8,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 999,
                    background: "var(--accent)",
                    boxShadow: "var(--led-halo-amber)",
                  }}
                />
              )}
              <Icon name={item.icon} filled={isActive} size={20} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span
                  className="fdc-mono"
                  style={{
                    fontSize: 11,
                    color: isActive ? "var(--accent)" : "var(--fg-3)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* footer — system info */}
      <div style={{ marginTop: "auto", padding: "16px 16px 4px" }}>
        <div className="card" style={{ padding: 12, background: "var(--surface-variant)", border: "1px solid var(--border-1)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Led color="green" pulse />
            <span className="fdc-label-strip">System</span>
          </div>
          <div style={{ marginTop: 8, font: "var(--text-body-sm)", color: "var(--fg-2)", display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 2, columnGap: 8 }}>
            <span className="fdc-label-strip">VER</span>
            <span className="fdc-mono" style={{ fontSize: 11 }}>2.6.1</span>
            <span className="fdc-label-strip">UP</span>
            <span className="fdc-mono" style={{ fontSize: 11 }}>14h 22m</span>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ── App shell wrapper ────────────────────────────────────── */
function AppShell({ children, active }) {
  return (
    <div
      className="fdc-root"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Topbar activeName={active} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar active={active} />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/* ── Page header (inside main content) ────────────────────── */
function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: "20px 28px 16px",
        gap: 16,
      }}
    >
      <div>
        {eyebrow && (
          <div className="fdc-label-strip" style={{ marginBottom: 6 }}>
            {eyebrow}
          </div>
        )}
        <h1
          style={{
            font: "var(--text-display-sm)",
            color: "var(--fg-1)",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: "6px 0 0", color: "var(--fg-2)", font: "var(--text-body)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

/* ── A toast notification ────────────────────────────────── */
function Toast({ kind = "success", title, body }) {
  const tone = {
    success: { icon: "check_circle", color: "var(--success)", bg: "var(--success-container)" },
    info:    { icon: "info",         color: "var(--info)",    bg: "var(--info-container)" },
    warning: { icon: "warning",      color: "var(--warning)", bg: "var(--warning-container)" },
    error:   { icon: "error",        color: "var(--error)",   bg: "var(--error-container)" },
  }[kind];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        background: "var(--surface-raised)",
        border: "1px solid var(--border-2)",
        borderLeft: `3px solid ${tone.color}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--elev-3)",
        minWidth: 280,
      }}
    >
      <span style={{ color: tone.color, display: "inline-flex", paddingTop: 1 }}>
        <Icon name={tone.icon} size={20} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ font: "var(--text-title-sm)", color: "var(--fg-1)" }}>{title}</div>
        {body && (
          <div style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", marginTop: 2 }}>
            {body}
          </div>
        )}
      </div>
      <button className="iconbtn" style={{ width: 24, height: 24 }}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/* ── Export everything to window so screens can use them ──── */
Object.assign(window, {
  cx, Icon, Led, Btn, Chip, LabelStrip, Topbar, HeaderStatus,
  DriveLed, Sidebar, AppShell, PageHeader, Toast, NAV_ITEMS,
});
