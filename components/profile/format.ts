export const fmtDateTime = (d: Date): string => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
