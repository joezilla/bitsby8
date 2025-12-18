import { DriveStatus } from '../types';

interface DriveStatusBannerProps {
  drives: DriveStatus[];
}

function StatusLed({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="status-led-group">
      <div className={`status-led${active ? ' active' : ''}`} />
      <span className="status-led-label">{label}</span>
    </div>
  );
}

export function DriveStatusBanner({ drives }: DriveStatusBannerProps) {
  const driveSlots = [0, 1, 2, 3];

  return (
    <div className="drive-status-banner">
      <div className="banner-title">Drive Status</div>
      <div className="status-drives">
        {driveSlots.map((slot) => {
          const drive = drives.find((d) => d.id === slot);
          const mounted = drive ? !!drive.mounted : false;
          const headLoaded = drive ? !!drive.headLoaded : false;
          const readonly = drive ? !!drive.readonly : false;

          return (
            <div key={slot} className="status-drive" id={`statusDrive${slot}`}>
              <div className="status-drive-label">Drive {slot}</div>
              <div className="status-indicators">
                <StatusLed active={mounted} label="Mounted" />
                <StatusLed active={headLoaded} label="Head Loaded" />
                <StatusLed active={readonly} label="Read-Only" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
