import { createContext, useContext, type ReactNode } from "react";

const PageQueryActivityContext = createContext(true);

export function PageQueryActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <PageQueryActivityContext.Provider value={active}>
      {children}
    </PageQueryActivityContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePageQueryActive(): boolean {
  return useContext(PageQueryActivityContext);
}
