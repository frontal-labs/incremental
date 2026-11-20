import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

export const renderWithUser = (ui: ReactElement) => ({
  user: userEvent.setup(),
  ...render(ui),
});
