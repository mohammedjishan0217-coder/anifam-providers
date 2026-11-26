import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      type: "text",
      key: "etp_rt",
      label: "Crunchyroll Session Token (etp_rt cookie)",
      placeholder: "Paste your etp_rt cookie value here",
      description:
        "Enter your browser's etp_rt cookie from crunchyroll.com for full access to your subscription streams.",
    },
    {
      type: "text",
      key: "accountEmail",
      label: "Account Email",
      defaultValue: "lertinerting13@gmail.com",
      description: "Crunchyroll account email address.",
    },
    {
      type: "select",
      key: "preferredAudio",
      label: "Preferred Audio Track",
      defaultValue: "ja-JP",
      options: [
        { label: "Japanese (Original)", value: "ja-JP" },
        { label: "English Dub", value: "en-US" },
        { label: "Hindi Dub", value: "hi-IN" },
        { label: "Spanish Dub", value: "es-419" },
        { label: "French Dub", value: "fr-FR" },
        { label: "German Dub", value: "de-DE" },
      ],
      description: "Prioritized audio track for anime series.",
    },
    {
      type: "select",
      key: "preferredSub",
      label: "Preferred Subtitle Language",
      defaultValue: "en-US",
      options: [
        { label: "English", value: "en-US" },
        { label: "Hindi", value: "hi-IN" },
        { label: "Spanish", value: "es-419" },
        { label: "French", value: "fr-FR" },
        { label: "German", value: "de-DE" },
        { label: "Arabic", value: "ar-SA" },
      ],
      description: "Default subtitle language for playback.",
    },
    {
      type: "text",
      key: "baseUrlOverride",
      label: "Custom Domain / Mirror URL",
      placeholder: "https://www.crunchyroll.com",
      defaultValue: "https://www.crunchyroll.com",
      description: "Override default website domain if blocked.",
    },
  ];
};
