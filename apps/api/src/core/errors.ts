import { HttpException } from "@nestjs/common";
export function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
export function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(400, "INVALID_ID", "无效的标识符");
  return value.toLowerCase();
}
