const minimumNewPasswordLength = 8;
const maximumWebNewPasswordLength = 72;

export const WEB_NEW_PASSWORD_LENGTH_HINT = `${minimumNewPasswordLength}–${maximumWebNewPasswordLength} 个字符`;

export function minimumNewPasswordLengthError(password: string): string | undefined {
  if (password.length < minimumNewPasswordLength) return `密码至少需要 ${minimumNewPasswordLength} 个字符。`;
}

export function webNewPasswordLengthError(password: string): string | undefined {
  const minimumError = minimumNewPasswordLengthError(password);
  if (minimumError) return minimumError;
  if (password.length > maximumWebNewPasswordLength) return `密码不能超过 ${maximumWebNewPasswordLength} 个字符。`;
}
