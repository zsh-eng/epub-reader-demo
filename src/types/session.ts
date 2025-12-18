export interface SessionBrowser {
  name: string;
  version: string;
}

export interface SessionOS {
  name: string;
  version: string;
}

export type DeviceType = "mobile" | "tablet" | "desktop";

export interface SessionInfo {
  id: string;
  browser: SessionBrowser;
  os: SessionOS;
  deviceType: DeviceType;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
}
