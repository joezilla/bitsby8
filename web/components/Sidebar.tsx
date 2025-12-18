import { useState } from 'react';
import { PageName } from '../types';

interface SidebarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
}

const navItems: { label: string; icon: string; page: PageName }[] = [
  { label: 'Home', icon: '🏠', page: 'home' },
  { label: 'Configuration', icon: '⚙️', page: 'config' },
  { label: 'Disk Management', icon: '💾', page: 'disks' }
];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <h2 className="sidebar-title">FDC+</h2>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label="Toggle sidebar"
          type="button"
        >
          <span>&#9776;</span>
        </button>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`nav-item${activePage === item.page ? ' active' : ''}`}
            onClick={() => onNavigate(item.page)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-text">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
