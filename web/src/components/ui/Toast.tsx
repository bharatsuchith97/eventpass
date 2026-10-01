import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';

/** Tiny toast helper: `const { toast, toastNode } = useToast()`; render `toastNode` once. */
export function useToast(): { toast: (message: string, severity?: 'success' | 'error' | 'info') => void; toastNode: ReactNode } {
  const [state, setState] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);
  const toast = useCallback((message: string, severity: 'success' | 'error' | 'info' = 'success') => setState({ message, severity }), []);
  const toastNode = (
    <Snackbar open={!!state} autoHideDuration={5000} onClose={() => setState(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity={state?.severity ?? 'success'} variant="filled" onClose={() => setState(null)}>
        {state?.message}
      </Alert>
    </Snackbar>
  );
  return { toast, toastNode };
}
