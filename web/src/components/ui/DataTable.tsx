import type { ReactNode } from 'react';
import { Box, LinearProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow } from '@mui/material';
import { EmptyState } from './basic';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  hideOnMobile?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: ReactNode;
  /** Server-side pagination. */
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  maxHeight?: number | string;
  onRowClick?: (row: T) => void;
}

/** Paginated table. Data is paged on the server, so only one page is ever rendered (scales to large guest lists). */
export function DataTable<T>({
  columns, rows, rowKey, loading, emptyTitle = 'Nothing here yet', emptyBody, emptyAction,
  page, pageSize, total, onPageChange, onPageSizeChange, maxHeight, onRowClick,
}: Props<T>) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      {loading && <LinearProgress />}
      <TableContainer sx={{ maxHeight }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ width: c.width, fontWeight: 700, display: c.hideOnMobile ? { xs: 'none', lg: 'table-cell' } : undefined }}>
                  {c.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(row) : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined }}>
                {columns.map((c) => (
                  <TableCell key={c.key} align={c.align} sx={{ display: c.hideOnMobile ? { xs: 'none', lg: 'table-cell' } : undefined }}>
                    {c.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!loading && rows.length === 0 && (
        <Box>
          <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />
        </Box>
      )}
      {total !== undefined && page !== undefined && pageSize !== undefined && onPageChange && (
        <TablePagination
          component="div"
          count={total}
          page={page - 1}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(_, p) => onPageChange(p + 1)}
          onRowsPerPageChange={(e) => onPageSizeChange?.(Number(e.target.value))}
        />
      )}
    </Paper>
  );
}
