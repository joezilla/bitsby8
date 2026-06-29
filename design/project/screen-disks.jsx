// FDC+ — Disks page mockup.

function ScreenDisks() {
  const drives = [
    { id: 0, mounted: true, filename: "cpm22.dsk",   track: 12, sector: 4, ro: false, active: true,  format: '8" SSSD' },
    { id: 1, mounted: true, filename: "games-vol2.img", track: 0, sector: 1, ro: true,  active: false, format: '8" SSDD' },
    { id: 2, mounted: false },
    { id: 3, mounted: false },
  ];

  const images = [
    { name: "cpm22.dsk",            size: "248 KB", format: "8\" SSSD", desc: "CP/M 2.2 boot disk — base system",          mountedOn: 0, mod: "2 days ago" },
    { name: "games-vol2.img",       size: "498 KB", format: "8\" SSDD", desc: "Adventure, Star Trek, Hammurabi",            mountedOn: 1, mod: "1 week ago" },
    { name: "turbopascal-30.dsk",   size: "248 KB", format: "8\" SSSD", desc: "Turbo Pascal 3.0 compiler + samples",        mountedOn: null, mod: "1 week ago" },
    { name: "wordstar-31.img",      size: "498 KB", format: "8\" SSDD", desc: "WordStar 3.1 with TeleVideo driver",         mountedOn: null, mod: "3 weeks ago" },
    { name: "fortran-iv.img",       size: "498 KB", format: "8\" SSDD", desc: "Microsoft FORTRAN IV runtime",               mountedOn: null, mod: "1 month ago" },
    { name: "ledger.dsk",           size: "248 KB", format: "8\" SSSD", desc: "Accounts ledger — Q3 1979",                  mountedOn: null, mod: "6 months ago" },
    { name: "blank-fresh.cpm",      size: "248 KB", format: "8\" SSSD", desc: "—",                                          mountedOn: null, mod: "yesterday" },
  ];

  return (
    <AppShell active="disks">
      <PageHeader
        eyebrow="Section · Storage · 4 drives connected"
        title="Disks"
        subtitle="Mount up to four virtual floppies on the controller and tend your image library."
        actions={
          <>
            <Btn variant="outline" size="sm" icon="upload">Upload image</Btn>
            <Btn variant="filled" size="sm" icon="add">New disk</Btn>
          </>
        }
      />

      <div style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 20, flex: 1, minHeight: 0, overflow: "auto" }}>

        {/* DRIVE BAY */}
        <section>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <h2 style={{ font: "var(--text-title)", margin: 0, color: "var(--fg-1)" }}>Drive bay</h2>
            <span className="fdc-label-strip">2 of 4 mounted · DRV-0 reading</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {drives.map((d) => <DriveCard key={d.id} drive={d} />)}
          </div>
        </section>

        {/* LIBRARY */}
        <section
          className="card"
          style={{
            padding: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* lib header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <Icon name="collections_bookmark" size={20} style={{ color: "var(--fg-2)" }} />
            <h2 style={{ font: "var(--text-title)", margin: 0, color: "var(--fg-1)" }}>Disk image library</h2>
            <span className="fdc-label-strip">{images.length} images · 2.4 MB total</span>

            <div style={{ flex: 1 }} />

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "0 12px",
                height: 32,
                borderRadius: 999,
                background: "var(--surface-sunken)",
                border: "1px solid var(--border-1)",
                minWidth: 260,
              }}
            >
              <Icon name="search" size={16} style={{ color: "var(--fg-3)" }} />
              <span style={{ font: "var(--text-body-sm)", color: "var(--fg-3)" }}>Filter images, descriptions…</span>
            </div>

            <div
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 999,
                background: "var(--surface-sunken)",
                border: "1px solid var(--border-1)",
              }}
            >
              <SegBtn icon="list" active />
              <SegBtn icon="grid_view" />
            </div>
          </div>

          {/* table */}
          <div style={{ padding: "0" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(220px, 2fr) 100px 110px minmax(240px, 3fr) 110px 140px",
                padding: "10px 18px",
                borderBottom: "1px solid var(--border-1)",
                gap: 16,
              }}
            >
              {["Name", "Size", "Format", "Description", "Modified", "Actions"].map((h, i) => (
                <span key={i} className="fdc-label-strip" style={{ textAlign: i === 1 || i === 5 ? "right" : "left" }}>
                  {h}
                </span>
              ))}
            </div>

            {images.map((img, i) => (
              <ImageRow key={img.name} img={img} alt={i % 2 === 0} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function DriveCard({ drive }) {
  const empty = !drive.mounted;
  const accent = drive.active ? "amber" : drive.mounted ? "green" : "off";

  return (
    <div
      className="card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        borderColor: drive.active ? "rgba(255,176,32,0.4)" : "var(--border-1)",
        boxShadow: drive.active
          ? "var(--elev-1), 0 0 0 1px rgba(255,176,32,0.25), 0 0 24px rgba(255,176,32,0.12)"
          : "var(--elev-1)",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="led led-md pulse" style={{ background: drive.active ? "var(--signal-amber)" : drive.mounted ? "var(--signal-green)" : "var(--neutral-50)", boxShadow: drive.active ? "var(--led-halo-amber)" : drive.mounted ? "var(--led-halo-green)" : "none", animation: drive.active ? "led-pulse 1.6s var(--ease-standard) infinite" : "none" }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span className="fdc-label-strip">Drive</span>
            <span style={{ font: "600 18px/1 var(--font-mono)", color: "var(--fg-1)", marginTop: 2 }}>
              {String(drive.id).padStart(2, "0")}
            </span>
          </div>
        </div>
        {drive.mounted && (
          <Chip color={drive.ro ? "amber" : "green"}>{drive.ro ? "RO" : "RW"}</Chip>
        )}
      </div>

      {/* body */}
      {empty ? (
        <div
          style={{
            border: "1px dashed var(--border-2)",
            borderRadius: "var(--radius-md)",
            padding: "14px 12px",
            textAlign: "center",
            color: "var(--fg-3)",
            font: "var(--text-body-sm)",
          }}
        >
          <Icon name="add" size={18} style={{ color: "var(--fg-3)", marginRight: 4 }} />
          Mount disk
        </div>
      ) : (
        <div>
          <div
            style={{
              font: "500 13px/1.3 var(--font-mono)",
              color: "var(--fg-1)",
              wordBreak: "break-all",
            }}
          >
            {drive.filename}
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span className="fdc-label-strip">{drive.format}</span>
            <span style={{ width: 1, height: 10, background: "var(--border-1)" }} />
            <span className="fdc-mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
              TRK {String(drive.track).padStart(2, "0")} · SEC {String(drive.sector).padStart(2, "0")}
            </span>
          </div>
          {/* read activity bar */}
          {drive.active && (
            <div style={{ marginTop: 10, position: "relative", height: 4, borderRadius: 2, background: "var(--surface-sunken)", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  height: "100%",
                  width: "40%",
                  background: "linear-gradient(90deg, transparent, var(--signal-amber), transparent)",
                  boxShadow: "0 0 8px rgba(255,176,32,0.5)",
                  animation: "fdc-scan 2.2s linear infinite",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingTop: 10,
          borderTop: "1px solid var(--border-1)",
          marginTop: "auto",
        }}
      >
        {empty ? (
          <Btn variant="tonal" size="sm" icon="save" style={{ flex: 1 }}>Mount…</Btn>
        ) : (
          <>
            <Btn variant="ghost" size="sm" icon="eject">Eject</Btn>
            <div style={{ flex: 1 }} />
            <button className="iconbtn" title="Read-only toggle">
              <Icon name={drive.ro ? "lock" : "lock_open"} size={16} />
            </button>
            <button className="iconbtn" title="More">
              <Icon name="more_horiz" size={18} />
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes fdc-scan {
          0%   { transform: translateX(-50%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}

function ImageRow({ img, alt }) {
  const mounted = img.mountedOn !== null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 2fr) 100px 110px minmax(240px, 3fr) 110px 140px",
        padding: "11px 18px",
        borderBottom: "1px solid var(--border-1)",
        gap: 16,
        alignItems: "center",
        background: alt ? "transparent" : "var(--surface-sunken)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <Icon name="save" size={18} style={{ color: mounted ? "var(--accent)" : "var(--fg-3)" }} filled={mounted} />
        <div style={{ minWidth: 0 }}>
          <div className="fdc-mono" style={{ fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {img.name}
          </div>
          {mounted && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <span className="led led-green" style={{ width: 6, height: 6 }} />
              <span className="fdc-label-strip" style={{ fontSize: 9, color: "var(--success)" }}>
                Mounted on DRV-{img.mountedOn}
              </span>
            </div>
          )}
        </div>
      </div>
      <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-2)", textAlign: "right" }}>{img.size}</span>
      <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>{img.format}</span>
      <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {img.desc}
      </span>
      <span style={{ font: "var(--text-body-sm)", color: "var(--fg-3)" }}>{img.mod}</span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
        <button className="iconbtn" title="Mount"><Icon name="save" size={16} /></button>
        <button className="iconbtn" title="Clone"><Icon name="content_copy" size={16} /></button>
        <button className="iconbtn" title="Edit notes"><Icon name="edit_note" size={18} /></button>
        <button className="iconbtn" title="Delete"><Icon name="delete" size={16} /></button>
      </div>
    </div>
  );
}

function SegBtn({ icon, active }) {
  return (
    <button
      className="iconbtn"
      style={{
        background: active ? "var(--surface)" : "transparent",
        boxShadow: active ? "var(--elev-1)" : "none",
        color: active ? "var(--fg-1)" : "var(--fg-3)",
        width: 28,
        height: 26,
        borderRadius: 999,
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

window.ScreenDisks = ScreenDisks;
