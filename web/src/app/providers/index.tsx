import { useMemo, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/client';
import { ME_KEY, useMe, useSettings } from '../../lib/auth/session';
import { setDisplayTimezone } from '../../lib/utils/format';

/** Any 401 anywhere drops the cached session, which sends the user to the login page. */
function onApiError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(ME_KEY, null);
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function BrandTheme({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { data: settings } = useSettings(!!me);
  setDisplayTimezone(settings?.timezone);
  const primary = settings?.primaryBrandColor ?? '#1565c0';
  const theme = useMemo(
    () =>
      createTheme({
        palette: { primary: { main: primary }, background: { default: '#f5f7fa' } },
        shape: { borderRadius: 10 },
        typography: { fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', button: { textTransform: 'none', fontWeight: 600 } },
        components: {
          MuiButton: { defaultProps: { disableElevation: true } },
          MuiTextField: { defaultProps: { fullWidth: true, size: 'small' } },
        },
      }),
    [primary],
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandTheme>{children}</BrandTheme>
    </QueryClientProvider>
  );
}
