/** Notification channel definitions shared by the settings page and its dialogs. */

export const ICONS = {
  inapp: 'M4 6h16v12H4z M4 7l8 6 8-6',
  push: 'M12 3a5 5 0 0 0-5 5v3l-2 3h14l-2-3V8a5 5 0 0 0-5-5z M10 18a2 2 0 0 0 4 0',
  webhook: 'M9 3v6 M15 3v6 M6 9h12v6a6 6 0 0 1-12 0z M12 15v6',
  telegram: 'm21 4-19 8 5 2 2 6 3-4 5 4z',
  email: 'M3 6h18v12H3z M3 7l9 6 9-6',
};

/**
 * Webhook targets. `generic` keeps the original payload (a superset of the
 * WeCom/DingTalk robot shape), so existing hooks keep working after upgrading.
 */
export const WEBHOOK_PROVIDERS = [
  {
    value: 'generic',
    label: '通用 JSON',
    hint: 'POST { msgtype, text: { content } }，并附带 subscriptionId / dueDate / daysLeft。',
  },
  {
    value: 'wecom',
    label: '企业微信群机器人',
    hint: '群机器人 → 添加机器人 → 复制 Webhook 地址；地址里的 key 就是凭据，不要外泄。',
  },
  {
    value: 'dingtalk',
    label: '钉钉群机器人',
    hint: '群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook 地址；安全设置选「加签」时把密钥填到下方。',
  },
  {
    value: 'feishu',
    label: '飞书群机器人',
    hint: '群设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook 地址；安全设置选「签名校验」时把密钥填到下方。',
  },
  {
    value: 'ntfy',
    label: 'ntfy',
    hint: '客户端自带推送通道，可自建，也可以直接用 ntfy.sh。',
  },
  {
    value: 'bark',
    label: 'Bark',
    hint: 'iOS 推送；地址形如 https://api.day.app/你的Key，可换成自建域名。',
  },
  {
    value: 'serverchan',
    label: 'Server 酱',
    hint: '推到微信服务号；地址形如 https://sctapi.ftqq.com/你的SendKey.send。',
  },
];

const WEBHOOK_PRESETS = {
  generic: {
    placeholder: 'https://example.com/hooks/subscriptions',
    hint: '你的服务会收到 POST JSON：{ msgtype: "text", text: { content } }。',
  },
  wecom: {
    placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
    hint: '群机器人 → 添加机器人 → 复制 Webhook 地址；地址里的 key 就是凭据，不要外泄。',
  },
  dingtalk: {
    placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…',
    hint: '群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook 地址；安全设置选「加签」时把密钥填到下方。',
  },
  feishu: {
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
    hint: '飞书使用 msg_type / content.text 字段，与其他两家不同，请求体会自动按飞书格式发送；安全设置选「签名校验」时把密钥填到下方。',
  },
  ntfy: {
    placeholder: 'https://ntfy.sh/你的订阅主题',
    hint: 'URL 末尾即主题名，在 ntfy 客户端订阅同一主题即可；服务端开启访问控制时填下方的访问令牌。',
  },
  bark: {
    placeholder: 'https://api.day.app/你的DeviceKey',
    hint: 'Bark App 首页能复制到带 Key 的推送地址；DeviceKey 即凭据，自建 Bark 换成自己的域名。',
  },
  serverchan: {
    placeholder: 'https://sctapi.ftqq.com/SCT….send',
    hint: 'SendKey 在 sct.ftqq.com 获取，地址形如 …/<SendKey>.send，消息将推送到微信。',
  },
};

function providerPreset(id) {
  return WEBHOOK_PRESETS[id] ?? WEBHOOK_PRESETS.generic;
}

export const CHANNELS = [
  {
    id: 'inapp',
    label: '站内提醒',
    description: '在「提醒」页面生成记录，导航栏显示未读红点。',
    enabledKey: 'channelInappEnabled',
    fields: [],
  },
  {
    id: 'push',
    label: '浏览器推送',
    description: '通过系统通知中心推送到手机 / 电脑，安装成 PWA 后体验最佳。',
    enabledKey: 'channelPushEnabled',
    // No form fields: the device is registered with a button instead.
    component: 'push',
    fields: [],
  },
  {
    id: 'webhook',
    label: 'Webhook 推送',
    description: '推到企业微信 / 钉钉 / 飞书，或 ntfy / Bark / Server 酱等自带推送服务的应用。',
    enabledKey: 'channelWebhookEnabled',
    fields: [
      {
        key: 'webhookProvider',
        label: '服务类型',
        type: 'select',
        options: WEBHOOK_PROVIDERS,
        hint: '部分浏览器没有可用的推送服务，可通过这些服务把提醒转发到微信 / ntfy / Bark。',
      },
      {
        key: 'webhookUrl',
        label: 'Webhook 地址',
        // Stored server-side as a secret: the hook URL usually carries the
        // credential, so it is written once and never sent back to the browser.
        type: 'url',
        secret: true,
        placeholder: (values) => providerPreset(values.webhookProvider).placeholder,
        hint: (values) => providerPreset(values.webhookProvider).hint,
        required: true,
      },
      {
        key: 'webhookSecret',
        label: '签名密钥',
        type: 'secret',
        // Only 钉钉（加签）and 飞书（签名校验）sign their requests.
        when: (values) => values.webhookProvider === 'feishu' || values.webhookProvider === 'dingtalk',
        placeholder: 'SEC… / 机器人安全设置里的密钥',
        hint: '钉钉「加签」的 SEC 密钥，或飞书「签名校验」的密钥；只有启用对应安全设置时才需要填写，签名会自动附加。若安全设置用的是「自定义关键词」，把「订阅提醒」加进关键词即可（消息正文固定以它开头）。',
      },
      {
        key: 'webhookToken',
        label: '访问令牌',
        type: 'secret',
        when: (values) => values.webhookProvider === 'ntfy',
        placeholder: 'tk_… 或 用户名:密码',
        hint: 'ntfy 服务开启访问控制时才需要；tk_ 开头的令牌按 Bearer 发送，填「用户名:密码」则改用 Basic 认证。',
      },
    ],
  },
  {
    id: 'telegram',
    label: 'Telegram Bot',
    description: '通过 Telegram Bot API 推送，需要 Bot Token 与 Chat ID。',
    enabledKey: 'channelTelegramEnabled',
    fields: [
      {
        key: 'telegramBotToken',
        label: 'Bot Token',
        type: 'secret',
        placeholder: '123456789:AAH…',
        hint: '在 Telegram 里找 @BotFather，/newbot 创建后获得 Token。',
      },
      {
        key: 'telegramChatId',
        label: 'Chat ID',
        type: 'text',
        placeholder: '-1001234567890',
        hint: '先给机器人发一条消息，再通过 @userinfobot 查询你的 Chat ID。',
        required: true,
      },
    ],
  },
  {
    id: 'email',
    label: '邮件通知',
    description: '直连 SMTP 邮件服务器，或走 Resend API / 自建网关。',
    enabledKey: 'channelEmailEnabled',
    fields: [
      {
        key: 'emailProvider',
        label: '发送方式',
        type: 'select',
        options: [
          { value: 'smtp', label: 'SMTP（465 / 587）', hint: '直接连接邮件服务器，最通用' },
          { value: 'resend', label: 'Resend API', hint: '官方 HTTP API，注册后即可用' },
          { value: 'http', label: '自定义 HTTP 邮件网关', hint: '对接你自己的转发服务' },
        ],
        hint: 'Workers 无法访问 25 端口，SMTP 请使用 465（隐式 TLS）或 587（STARTTLS）。',
      },
      {
        key: 'smtpHost',
        label: 'SMTP 服务器',
        type: 'text',
        when: (values) => values.emailProvider === 'smtp',
        placeholder: 'smtp.example.com',
        required: true,
        hint: '填写邮件服务商给出的发信服务器地址。',
      },
      {
        key: 'smtpSecure',
        label: '加密方式',
        type: 'select',
        when: (values) => values.emailProvider === 'smtp',
        options: [
          { value: 'tls', label: '465 · 隐式 TLS', hint: '连接即加密，推荐' },
          { value: 'starttls', label: '587 · STARTTLS', hint: '先明文连接再升级为 TLS' },
        ],
      },
      {
        key: 'smtpPort',
        label: '端口',
        type: 'text',
        when: (values) => values.emailProvider === 'smtp',
        placeholder: (values) => (values.smtpSecure === 'starttls' ? '587' : '465'),
        hint: '留空则按加密方式自动选择（465 / 587）。',
      },
      {
        key: 'smtpUser',
        label: 'SMTP 用户名',
        type: 'text',
        when: (values) => values.emailProvider === 'smtp',
        placeholder: 'bot@example.com',
        hint: '多数服务商要求用邮箱地址作为用户名；不需要认证时留空。',
      },
      {
        key: 'smtpPassword',
        label: 'SMTP 密码 / 授权码',
        type: 'secret',
        when: (values) => values.emailProvider === 'smtp',
        placeholder: '授权码',
        hint: 'QQ / 163 等邮箱需要先在设置里开启 SMTP 并生成授权码，而不是登录密码。',
      },
      {
        key: 'emailApiKey',
        label: 'Resend API Key',
        type: 'secret',
        placeholder: 're_…',
        when: (values) => values.emailProvider === 'resend',
        hint: '在 resend.com 的 API Keys 页面创建。',
      },
      {
        key: 'emailEndpoint',
        label: '邮件网关地址',
        type: 'url',
        placeholder: 'https://mail.example.com/send',
        when: (values) => values.emailProvider === 'http',
        required: true,
        hint: '该地址会收到 POST JSON：{ from, to, subject, text }。',
      },
      {
        key: 'emailFrom',
        label: '发件人',
        type: 'text',
        placeholder: '订阅提醒 <bot@your-domain.com>',
        hint: 'Resend 需要已验证域名的发件地址。',
        required: true,
      },
      {
        key: 'emailTo',
        label: '收件人',
        type: 'text',
        placeholder: 'me@example.com',
        hint: '多个地址用英文逗号分隔。',
        required: true,
      },
    ],
  },
];

export function channelById(id) {
  return CHANNELS.find((channel) => channel.id === id) ?? null;
}

/**
 * Fields whose `placeholder` / `hint` are functions are resolved against the
 * current form values, so a select can retarget the input below it.
 */
export function visibleFields(channel, values) {
  return channel.fields
    .filter((field) => (typeof field.when === 'function' ? field.when(values) : true))
    .map((field) => ({
      ...field,
      placeholder: typeof field.placeholder === 'function' ? field.placeholder(values) : field.placeholder,
      hint: typeof field.hint === 'function' ? field.hint(values) : field.hint,
    }));
}

export function channelLabel(id) {
  return channelById(id)?.label ?? id;
}

export const DELIVERY_STATES = {
  sent: '已发送',
  failed: '发送失败',
  skipped: '未推送',
};
