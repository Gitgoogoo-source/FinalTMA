import { Mail, MessageCircle } from "lucide-react";

import type { PaymentSupportConfig } from "../box.types";

type PaymentSupportLinksProps = {
  config: PaymentSupportConfig | null;
};

export function PaymentSupportLinks({ config }: PaymentSupportLinksProps) {
  if (!config?.configured) {
    return null;
  }

  const hasUrl = Boolean(config.supportUrl);
  const hasEmail = Boolean(config.supportEmail);

  if (!hasUrl && !hasEmail) {
    return null;
  }

  return (
    <div className="payment-support-links">
      {config.supportUrl ? (
        <a href={config.supportUrl} rel="noreferrer" target="_blank">
          <MessageCircle aria-hidden="true" size={14} strokeWidth={2.5} />
          联系客服
        </a>
      ) : null}
      {config.supportEmail ? (
        <a href={`mailto:${config.supportEmail}`}>
          <Mail aria-hidden="true" size={14} strokeWidth={2.5} />
          发送邮件
        </a>
      ) : null}
    </div>
  );
}
