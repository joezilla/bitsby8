import { useEffect } from 'react';
import { NotificationKind } from '../types';

interface NotificationProps {
  message: string;
  type: NotificationKind;
  onHide: () => void;
}

export function Notification({ message, type, onHide }: NotificationProps) {
  useEffect(() => {
    const timer = setTimeout(onHide, 3000);
    return () => clearTimeout(timer);
  }, [onHide, message]);

  return (
    <div className={`notification ${type} show`} id="notification">
      <div id="notificationMessage">{message}</div>
    </div>
  );
}
