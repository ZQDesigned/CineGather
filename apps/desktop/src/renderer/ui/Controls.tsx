import {
  Button as AntButton,
  Input,
  type ButtonProps as AntButtonProps,
} from "antd";
import styled from "@emotion/styled";
export { Input };
export const TextArea = Input.TextArea;

const CinemaButton = styled(AntButton)`
  &:where(.ant-btn) {
    height: auto;
    min-height: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
    background: transparent;
    color: inherit;
    border-radius: 0;
    line-height: inherit;
    justify-content: normal;
    white-space: normal;
  }
  &:where(.ant-btn):disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:where(.ant-btn):not(:disabled):active {
    transform: translateY(1px);
  }
  &:where(.ant-btn) > svg {
    display: block;
  }
  &:where(.ant-btn.room-card) {
    display: block;
    width: 100%;
  }
`;
// Keep the existing form/accessible-name contract while Ant Design owns button
// interaction, focus, disabled states and theme behavior.
export function Button({
  type = "submit",
  className = "",
  ...props
}: Omit<AntButtonProps, "type" | "htmlType"> & {
  type?: "button" | "submit" | "reset";
}) {
  return (
    <CinemaButton
      {...props}
      htmlType={type}
      type={className.split(" ").includes("primary") ? "primary" : "text"}
      className={className}
    />
  );
}
