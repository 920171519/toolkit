export type TransferFormFields = {
  version: string;
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string;
};

export const TRANSFER_CHANGE_SUMMARY_MIN_LENGTH = 5;

const transferLinkPrefix = /^https?:\/\//i;

export function invalidTransferFields({ version, changeSummary, archiveUrl, buildUrl }: TransferFormFields) {
  const fields: Array<keyof TransferFormFields> = [];
  if (!version.trim()) fields.push("version");
  if (changeSummary.trim().length < TRANSFER_CHANGE_SUMMARY_MIN_LENGTH) fields.push("changeSummary");
  if (!transferLinkPrefix.test(archiveUrl.trim())) fields.push("archiveUrl");
  if (!transferLinkPrefix.test(buildUrl.trim())) fields.push("buildUrl");
  return fields;
}
