import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      type: "text",
      key: "baseUrlOverride",
      label: "Custom Domain / Mirror URL",
      placeholder: "https://comix.to",
      description: "Override default comix.to domain if blocked.",
    },
    {
      type: "select",
      key: "chapterOrder",
      label: "Chapter List Order",
      defaultValue: "asc",
      options: [
        { label: "Ascending (Ch.1 → Latest)", value: "asc" },
        { label: "Descending (Latest → Ch.1)", value: "desc" },
      ],
      description: "Order chapters on comic detail pages.",
    },
  ];
};
