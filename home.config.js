export default {
  name: '极目',
  // 64×64 PNG，4px 手臂，≤ 18000 bytes；留空则用默认角色。见 docs/avatar.md
  skin: '',
  languages: ['zh'],
  // 实时天气/昼夜：上海
  weather: { city: '上海', cityEn: 'Shanghai', latitude: 31.23, longitude: 121.47, timezone: 'Asia/Shanghai' },
  // Dock 顺序：书架、博客、关于、留言、手机
  dock: ['library', 'blog', 'about', 'mailbox', 'phone'],
  // 留言板：endpoint 留空时打开访客的邮件客户端，记得填邮箱
  mailbox: { endpoint: '', email: '', turnstileSitekey: '' },
  badge: true,
};
