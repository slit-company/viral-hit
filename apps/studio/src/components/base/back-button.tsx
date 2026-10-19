import { ArrowLeft } from "@phosphor-icons/react";
import { ActionButton, Icon } from "@seed-design/react";
import type { Ref } from "react";

/**
 * 앱 전체의 뒤로가기·나가기 버튼. 크기(44px 원)·아이콘(24px)·hover·눌림·포커스는 chrome.css `.app-back` 한 곳에서만 정한다.
 * 화면 CSS는 색과 위치만 바꾼다(DESIGN.md "뒤로가기 버튼"). 사진·영상 위에 떠 있는 버튼만 floating을 쓴다.
 * `check:design`의 back-button-shared 규칙이 이 컴포넌트를 거치지 않은 뒤로가기 버튼을 막는다.
 */
export function BackButton({ onClick, label = "뒤로 가기", className, floating, disabled, ref, qa }: {
  onClick?: () => void;
  label?: string;
  className?: string;
  floating?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  /** 브라우저 테스트용 data-qa 표식. 화면 동작과 무관하다. */
  qa?: string;
}) {
  const classes = ["app-back", floating ? "app-back-floating" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <ActionButton ref={ref} type="button" variant="ghost" size="medium" layout="iconOnly" className={classes} aria-label={label} data-qa={qa} disabled={disabled} onClick={onClick}>
      <Icon svg={<ArrowLeft size={24} />} />
    </ActionButton>
  );
}
