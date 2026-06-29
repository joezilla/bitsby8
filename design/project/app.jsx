// FDC+ design system — main app. Composes screens into a DesignCanvas.

const { useEffect: useEffectApp, useState: useStateApp } = React;

const SCREEN_W = 1340;
const SCREEN_H = 820;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark"
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme to <html data-theme="...">
  useEffectApp(() => {
    document.documentElement.dataset.theme = tweaks.theme;
  }, [tweaks.theme]);

  return (
    <>
      <DesignCanvas>
        <DCSection id="foundations" title="Foundations" subtitle="Tokens, type, signal pips, and the Altair label-strip motif.">
          <DCArtboard id="found" label="Design tokens & components" width={1340} height={1080}>
            <ScreenFoundations />
          </DCArtboard>
        </DCSection>

        <DCSection id="terminal" title="Terminal" subtitle="VT102 serial console. Three phosphor modes — modern, amber, green.">
          <DCArtboard id="term-modern" label="Modern · default" width={SCREEN_W} height={SCREEN_H}>
            <ScreenTerminal crt="off" />
          </DCArtboard>
          <DCArtboard id="term-amber" label="Amber P3 phosphor" width={SCREEN_W} height={SCREEN_H}>
            <ScreenTerminal crt="amber" />
          </DCArtboard>
          <DCArtboard id="term-green" label="Green P1 phosphor" width={SCREEN_W} height={SCREEN_H}>
            <ScreenTerminal crt="green" />
          </DCArtboard>
        </DCSection>

        <DCSection id="disks" title="Disks" subtitle="Drive bay (4 mounts) and the image library — the operational center of the app.">
          <DCArtboard id="disks-main" label="Drive bay + library" width={SCREEN_W} height={SCREEN_H}>
            <ScreenDisks />
          </DCArtboard>
        </DCSection>

        <DCSection id="cassettes" title="Cassettes" subtitle="Audio tapes streamed to the controller (Kansas City standard).">
          <DCArtboard id="cassettes-main" label="Now playing + library" width={SCREEN_W} height={SCREEN_H}>
            <ScreenCassettes />
          </DCArtboard>
        </DCSection>

        <DCSection id="scripts" title="Scripts" subtitle="Automation routines for disk mounts and serial workflows.">
          <DCArtboard id="scripts-main" label="List + editor" width={SCREEN_W} height={SCREEN_H}>
            <ScreenScripts />
          </DCArtboard>
        </DCSection>

        <DCSection id="config" title="Config" subtitle="Serial controller, disk serving, terminal, operator.">
          <DCArtboard id="config-main" label="System configuration" width={SCREEN_W} height={SCREEN_H}>
            <ScreenConfig />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakRadio
          label="Mode"
          value={tweaks.theme}
          options={[
            { value: "dark",  label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(v) => setTweak("theme", v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
