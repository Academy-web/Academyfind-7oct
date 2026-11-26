export const NEW_MESSAGE_EMAIL_SUBJECT =
  "You have received a new message on AcademyFind";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildNewMessageEmailHtml(params: {
  recipientName?: string | null;
  senderName: string;
  conversationLabel?: string | null;
  messagePreview: string;
  chatUrl: string;
}): string {
  const recipient = escapeHtml(params.recipientName?.trim() || "there");
  const sender = escapeHtml(params.senderName);
  const contextLabel = params.conversationLabel
    ? escapeHtml(params.conversationLabel)
    : null;
  const preview = escapeHtml(params.messagePreview);
  const chatUrl = escapeHtml(params.chatUrl);

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.65; background-color: #ffffff; padding: 24px; border: 1px solid #f1f5f9; border-radius: 16px;">
    <div style="text-align: center; padding: 12px 0 20px 0; border-bottom: 1px solid #fde68a;">
      <h1 style="color: #d97706; margin: 0; font-size: 24px; letter-spacing: -0.5px;">AcademyFind</h1>
    </div>

    <div style="padding-top: 22px;">
      <p style="margin: 0 0 14px 0;">Hi <strong>${recipient}</strong>,</p>

      <p style="margin: 0 0 16px 0; font-size: 16px; color: #0f172a;">
        <strong>You have received a new message on AcademyFind</strong> from <strong>${sender}</strong>${contextLabel ? ` in <strong>${contextLabel}</strong>` : ""}.
      </p>

      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 10px; padding: 14px 16px; margin: 0 0 22px 0;">
        <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #b45309;">Message Preview</p>
        <p style="margin: 0; font-size: 14px; color: #334155;">${preview}</p>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${chatUrl}" style="display: inline-block; background-color: #f59e0b; color: #ffffff; padding: 12px 26px; text-decoration: none; border-radius: 9999px; font-weight: bold; font-size: 14px;">View &amp; Reply on AcademyFind</a>
      </div>

      <p style="margin: 24px 0 0 0; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        You received this email because you are a participant in this conversation on AcademyFind. If the button doesn't work, open: <a href="${chatUrl}" style="color: #b45309; word-break: break-all;">${chatUrl}</a>
      </p>
    </div>
  </div>
  `.trim();
}
