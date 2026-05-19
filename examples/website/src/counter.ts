import { t } from "@zintl/vite/macro";

export function setupCounter(element: HTMLButtonElement) {
  let counter = 0;
  const setCounter = (count: number) => {
    counter = count;
    // @zintl-note This is a note for the compiler
    element.innerHTML = t(
      "{counter, plural, =0 {Start Counting Now!} one {Count is One.} =2 {Count is Two} other {Count is #}}",
      { counter },
    );
  };
  element.addEventListener("click", () => setCounter(counter + 1));
  setCounter(0);
}
