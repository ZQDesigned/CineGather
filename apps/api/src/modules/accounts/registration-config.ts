export function registrationDefault(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("REGISTRATION_ENABLED must be true or false");
}
