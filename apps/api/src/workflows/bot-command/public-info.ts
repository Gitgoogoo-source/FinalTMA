import { getEnv, getReferralEnv } from "../../platform/env/index.ts";

export type PublicBotCommandReply = {
  text: string;
  button: { text: string; url: string };
};

type PublicCommand = "privacy" | "start" | "terms";

export function publicBotCommandReply(
  text: string,
): PublicBotCommandReply | null {
  const command = parsePublicCommand(text);
  if (!command) return null;

  if (command === "start")
    return {
      text: [
        "Welcome to EvoMyPet! 🐾",
        "Hatch collectible pets, build your collection, evolve favorites, trade in the marketplace and battle other players.",
      ].join("\n"),
      button: { text: "Open EvoMyPet", url: miniAppUrl() },
    };

  if (command === "privacy")
    return {
      text: "Read the EvoMyPet Privacy Policy:",
      button: { text: "Privacy Policy", url: publicPageUrl("privacy.html") },
    };

  return {
    text: "Read the EvoMyPet Terms of Use:",
    button: { text: "Terms of Use", url: publicPageUrl("terms.html") },
  };
}

function parsePublicCommand(text: string): PublicCommand | null {
  const parts = text.trim().split(/\s+/);
  const head = parts[0]?.toLowerCase();
  if (!head?.startsWith("/")) return null;

  const [name, addressedBot] = head.slice(1).split("@", 2);
  if (
    addressedBot &&
    addressedBot !== getReferralEnv().TELEGRAM_BOT_USERNAME.toLowerCase()
  )
    return null;

  if (name === "start") return "start";
  if (parts.length !== 1) return null;
  if (name === "privacy" || name === "terms") return name;
  return null;
}

function miniAppUrl(): string {
  const env = getReferralEnv();
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINI_APP_SHORT_NAME}`;
}

function publicPageUrl(page: "privacy.html" | "terms.html"): string {
  return new URL(`/${page}`, getEnv().APP_BASE_URL).toString();
}
