// FDC+ — Terminal page mockup. Three variants: Modern, Amber CRT, Green CRT.

const { useState: useStateT } = React;

function ScreenTerminal({ crt = "off" }) {
  // Phosphor palette
  const crtMap = {
    off:   { bg: "#0c0e12", fg: "#c8d0dc", cursor: "#c8d0dc", glow: null },
    amber: { bg: "#160d02", fg: "#ffb04a", cursor: "#ffd07a", glow: "rgba(255,176,32,0.55)" },
    green: { bg: "#02160a", fg: "#5ae08a", cursor: "#9eff9e", glow: "rgba(94,224,138,0.55)" },
  };
  const c = crtMap[crt];
  const isPhosphor = crt !== "off";

  return (
    <AppShell active="terminal">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "16px 24px 24px" }}>
        {/* eyebrow + title */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div className="fdc-label-strip" style={{ marginBottom: 6 }}>
              Section · Serial Terminal · VT102
            </div>
            <h1 style={{ font: "var(--text-display-sm)", color: "var(--fg-1)", margin: 0 }}>
              Terminal
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Chip color="cyan" icon="cable">/dev/cu.usbserial · 9600 8N1</Chip>
            <span style={{ width: 1, height: 24, background: "var(--border-1)" }} />
            <Btn variant="ghost" size="sm" icon="refresh">Refresh ports</Btn>
            <Btn variant="ghost" size="sm" icon="settings">Settings</Btn>
          </div>
        </div>

        {/* Connection bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 16px",
            background: "var(--surface)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--radius-md) var(--radius-md) 0 0",
            borderBottom: "none",
          }}
        >
          <Field label="Port" mono>/dev/cu.usbserial-1410</Field>
          <Field label="Baud" mono>9600</Field>
          <Field label="Data" mono>8</Field>
          <Field label="Parity" mono>none</Field>
          <Field label="Stop" mono>1</Field>
          <Field label="Flow" mono>none</Field>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CrtToggle current={crt} />
            <Btn variant="ghost" size="sm" icon="cleaning_services">Clear</Btn>
            <Btn variant="ghost" size="sm" icon="fullscreen" />
            <Btn variant="filled" size="sm" icon="link_off">Disconnect</Btn>
          </div>
        </div>

        {/* Terminal — phosphor or modern */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            background: c.bg,
            border: "1px solid var(--border-1)",
            borderTop: "1px solid var(--border-2)",
            borderRadius: "0 0 var(--radius-md) var(--radius-md)",
            overflow: "hidden",
            // subtle inner darkening on phosphor — like the curve of glass
            boxShadow: isPhosphor ? "inset 0 0 80px rgba(0,0,0,0.55), inset 0 0 18px rgba(0,0,0,0.35)" : "none",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* CRT scanline overlay */}
          {isPhosphor && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0.18) 2px)",
                zIndex: 2,
              }}
            />
          )}
          {/* CRT vignette */}
          {isPhosphor && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "radial-gradient(ellipse 70% 60% at center, transparent 55%, rgba(0,0,0,0.5) 100%)",
                zIndex: 3,
              }}
            />
          )}

          {/* Terminal content */}
          <pre
            style={{
              margin: 0,
              padding: "18px 22px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.45,
              color: c.fg,
              flex: 1,
              textShadow: isPhosphor ? `0 0 4px ${c.glow}` : "none",
              position: "relative",
              zIndex: 1,
              overflow: "hidden",
              whiteSpace: "pre",
              fontFeatureSettings: '"zero"',
            }}
          >
{`MITS ALTAIR 8800 — CP/M VER. 2.2
A>DIR
A: PIP      COM : ED       COM : ASM      COM : DDT      COM
A: STAT     COM : SUBMIT   COM : XSUB     COM : LOAD     COM
A: BIOS     SYS : CCP      SYS : BDOS     SYS

A>STAT B:
B: R/W, Space: 241k

A>PIP B:=A:*.TXT[V]
COPYING -
README.TXT
TIPS.TXT
INVENTORY.TXT
*** END OF COPY ***

A>TYPE README.TXT
FDC+ VIRTUAL DISK SERVER
Tend your archive: mount up to four
disks on the Altair via the serial
controller. Cassettes serve as audio.

Type HELP for a list of CP/M commands.

A>`}
            <span
              style={{
                display: "inline-block",
                width: "0.6em",
                height: "1.05em",
                background: c.cursor,
                verticalAlign: "text-bottom",
                marginLeft: 1,
                boxShadow: isPhosphor ? `0 0 6px ${c.glow}` : "none",
                animation: "fdc-cursor 1.05s steps(2) infinite",
              }}
            />
          </pre>

          {/* CRT corner label — subtle Altair-esque silk-screen */}
          {isPhosphor && (
            <div
              style={{
                position: "absolute",
                left: 14,
                bottom: 10,
                font: 'var(--text-overline)',
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.22em",
                color: c.fg,
                opacity: 0.4,
                textShadow: `0 0 4px ${c.glow}`,
                zIndex: 4,
              }}
            >
              {crt === "amber" ? "AMBER P3" : "P1 PHOSPHOR"} · 80×24
            </div>
          )}
          {/* power LED */}
          <div
            style={{
              position: "absolute",
              right: 14,
              bottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
              zIndex: 4,
            }}
          >
            <span className="led led-green pulse" />
            <span className="fdc-label-strip" style={{ color: isPhosphor ? c.fg : "var(--fg-3)", opacity: isPhosphor ? 0.5 : 1 }}>
              RX
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fdc-cursor {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </AppShell>
  );
}

function Field({ label, mono, children }) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span className="fdc-label-strip" style={{ fontSize: 9 }}>{label}</span>
      <span
        style={{
          font: mono ? "500 13px/1 var(--font-mono)" : "var(--text-body-sm)",
          color: "var(--fg-1)",
          padding: "5px 10px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-1)",
          background: "var(--surface-sunken)",
        }}
      >
        {children}
        <Icon name="expand_more" size={16} style={{ marginLeft: 4, color: "var(--fg-3)" }} />
      </span>
    </label>
  );
}

function CrtToggle({ current }) {
  const opts = [
    { id: "off",   color: "var(--neutral-50)" },
    { id: "amber", color: "var(--crt-amber)" },
    { id: "green", color: "var(--crt-green)" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 3,
        borderRadius: 999,
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-1)",
        marginRight: 6,
      }}
      title="CRT mode"
    >
      <Icon name="tv" size={16} style={{ color: "var(--fg-3)", marginLeft: 6 }} />
      {opts.map((o) => {
        const active = o.id === current;
        return (
          <span
            key={o.id}
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: active ? o.color : "transparent",
              border: active ? "none" : "1px solid var(--border-2)",
              boxShadow: active && o.id !== "off" ? `0 0 8px ${o.color}` : "none",
              display: "inline-block",
            }}
          />
        );
      })}
    </div>
  );
}

window.ScreenTerminal = ScreenTerminal;
