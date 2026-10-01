import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import TableChartIcon from '@mui/icons-material/TableChart';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { ErrorAlert, PageHeader } from '../../components/ui';

interface Integration { id: string; name: string; status: string; available: boolean }

export function IntegrationsPage() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: async () => (await api<{ items: Integration[] }>('/integrations')).items });
  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect EventPass to the tools you already use" />
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <Stack gap={2} maxWidth={720}>
        {(q.data ?? []).map((i) => (
          <Card key={i.id} variant="outlined">
            <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TableChartIcon color="success" sx={{ fontSize: 40 }} />
              <div style={{ flexGrow: 1, minWidth: 200 }}>
                <Typography fontWeight={700}>{i.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Export guests, attendance and RSVPs to a spreadsheet. PostgreSQL stays the source of truth; the sheet is a read-only copy.
                </Typography>
              </div>
              <Chip label="Coming soon" size="small" />
              <Button disabled>Connect</Button>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </>
  );
}
