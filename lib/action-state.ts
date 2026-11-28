export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  // Successful submissions redirect instead of returning a form state.
  success?: never;
};
