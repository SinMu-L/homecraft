// 1 block = 1 m. x east, z south, y up.
export const ISLAND = { x0: -36, x1: 38, z0: -26, z1: 31 };
export const SPAWN = { x: 0.5, z: 18, heading: Math.PI };

export const STATIONS = [
  { id: 'mailbox', name: '留言', en: 'Mailbox', icon: 'mail', at: [0.5, 23.9], look: [0.5, 25.5] },
  { id: 'portal', name: '传送门', en: 'Portal', icon: 'portal', at: [8, 23.1], look: [8, 25.5] },
  // 书房里的两个站位：书架前、书桌前（书桌上的"电脑"就是博客）
  { id: 'library', name: '书架', en: 'Library', icon: 'blog', at: [-3, 9.2], look: [-3, 7] },
  { id: 'blog', name: '博客', en: 'Blog', icon: 'blog', at: [1.8, 9.4], look: [1.8, 7.6] },
];

export const MAILBOX = { x: 0.5, z: 25.5, yaw: Math.PI };
export const PORTAL = { x: 8, z: 25.5, yaw: Math.PI };
export const TREES = [[30, -12]];
