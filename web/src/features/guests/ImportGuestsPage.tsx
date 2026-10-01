import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, CardContent, Checkbox, Chip, FormControlLabel, Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import UploadIcon from '@mui/icons-material/UploadFile';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api/client';
import { PageHeader } from '../../components/ui';
import { useEvent } from '../events/api';
import type { ImportPreview } from '../../types';

interface CommitResult {
  imported: number;
  skippedRows: number;
  tickets?: { issued: number; invited: number };
}

const TEMPLATE = 'first_name,last_name,email,phone,company_name,category\nAda,Lovelace,ada@example.com,+15550000001,Analytical Engines,VIP\n';
const MAX_BYTES = 5_000_000;

export function ImportGuestsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const eventId = params.get('eventId') ?? '';
  const event = useEvent(eventId);
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [passes, setPasses] = useState(true);
  const [send, setSend] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const preview = useMutation({ mutationFn: (text: string) => api<ImportPreview>('/guests/import/preview', { method: 'POST', body: { csv: text } }) });
  const commit = useMutation({
    mutationFn: () =>
      api<CommitResult>('/guests/import/commit', {
        method: 'POST',
        body: { csv, skipInvalid, ...(eventId && passes ? { eventId, generatePasses: true, sendInvitations: send } : {}) },
      }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: ['event-stats'] });
    },
  });

  const onFile = async (f: File | undefined) => {
    setReadError(null);
    preview.reset();
    commit.reset();
    if (!f) return;
    if (f.size > MAX_BYTES) return setReadError('That file is larger than 5 MB.');
    if (!/\.(csv|txt)$/i.test(f.name)) return setReadError('Please choose a .csv file. In Excel use File > Save As > CSV.');
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    preview.mutate(text);
  };

  const p = preview.data;
  const step = result ? 3 : p ? 2 : 0;
  const canImport = !!p && p.validRows > 0 && (p.invalidRows === 0 || skipInvalid);

  return (
    <>
      <PageHeader title="Import guests" subtitle={eventId && event.data ? `Adding to ${event.data.name}` : 'Upload a CSV, review it, then confirm'} />
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {['Upload', 'Review', 'Confirm', 'Done'].map((s) => (
          <Step key={s}>
            <StepLabel>{s}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {result ? (
        <Card variant="outlined">
          <CardContent>
            <Stack gap={2} alignItems="flex-start">
              <Alert severity="success" sx={{ width: '100%' }}>
                Imported {result.imported} guest{result.imported === 1 ? '' : 's'}
                {result.skippedRows ? `, skipped ${result.skippedRows} row${result.skippedRows === 1 ? '' : 's'} with problems` : ''}
                {result.tickets
                  ? `. Created ${result.tickets.issued} pass${result.tickets.issued === 1 ? '' : 'es'}${result.tickets.invited ? ` and sent ${result.tickets.invited} invitation${result.tickets.invited === 1 ? '' : 's'}` : ''}.`
                  : '.'}
              </Alert>
              <Stack direction="row" gap={1}>
                {eventId && <Button variant="contained" onClick={() => nav(`/events/${eventId}?tab=guests`)}>Go to event</Button>}
                <Button variant={eventId ? 'text' : 'contained'} onClick={() => nav('/guests')}>View guests</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Stack gap={3}>
          <Card variant="outlined">
            <CardContent>
              <Stack gap={2}>
                <Typography>
                  Required columns: <b>first_name, last_name, email</b>. Optional: phone, company_name, category (VIP, SPEAKER, SPONSOR, STAFF, ATTENDEE, FAMILY, OTHER).
                </Typography>
                <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
                  <input ref={file} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                  <Button variant="contained" startIcon={<UploadIcon />} onClick={() => file.current?.click()} disabled={preview.isPending}>
                    {fileName ? 'Choose another file' : 'Choose CSV file'}
                  </Button>
                  <Button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
                      a.download = 'guest-template.csv';
                      a.click();
                    }}
                  >
                    Download template
                  </Button>
                  {fileName && <Chip label={fileName} onDelete={() => { setCsv(''); setFileName(''); preview.reset(); }} />}
                </Stack>
                {readError && <Alert severity="error">{readError}</Alert>}
                {preview.error && <Alert severity="error">{preview.error.message}</Alert>}
                {preview.isPending && <Alert severity="info">Checking your file...</Alert>}
              </Stack>
            </CardContent>
          </Card>

          {p && (
            <Card variant="outlined">
              <CardContent>
                <Stack gap={2}>
                  <Typography variant="h6" fontWeight={700}>Review</Typography>
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Chip label={`${p.totalRows} rows`} />
                    <Chip color="success" label={`${p.validRows} ready to import`} />
                    <Chip color={p.invalidRows ? 'error' : 'default'} label={`${p.invalidRows} with problems`} />
                  </Stack>

                  {p.errors.length > 0 && (
                    <TableContainer sx={{ maxHeight: 280, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow><TableCell>Row</TableCell><TableCell>Field</TableCell><TableCell>Problem</TableCell></TableRow>
                        </TableHead>
                        <TableBody>
                          {p.errors.map((e, i) => (
                            <TableRow key={i}>
                              <TableCell>Row {e.row}</TableCell>
                              <TableCell>{e.field.replace(/([A-Z])/g, ' $1').toLowerCase()}</TableCell>
                              <TableCell>{e.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  {p.sample.length > 0 && (
                    <>
                      <Typography variant="subtitle2" color="text.secondary">Preview of valid rows</Typography>
                      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow><TableCell>Row</TableCell><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Category</TableCell></TableRow>
                          </TableHead>
                          <TableBody>
                            {p.sample.map((s) => (
                              <TableRow key={s.row}>
                                <TableCell>{s.row}</TableCell>
                                <TableCell>{s.firstName} {s.lastName}</TableCell>
                                <TableCell>{s.email}</TableCell>
                                <TableCell>{s.category}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </>
                  )}

                  <Stack>
                    {p.invalidRows > 0 && (
                      <FormControlLabel control={<Checkbox checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />} label={`Skip the ${p.invalidRows} problem row${p.invalidRows === 1 ? '' : 's'} and import the rest`} />
                    )}
                    {eventId && (
                      <>
                        <FormControlLabel control={<Checkbox checked={passes} onChange={(e) => setPasses(e.target.checked)} />} label={`Generate QR passes for ${event.data?.name ?? 'this event'}`} />
                        {passes && <FormControlLabel sx={{ pl: 3 }} control={<Checkbox checked={send} onChange={(e) => setSend(e.target.checked)} />} label="Email invitations right away" />}
                      </>
                    )}
                  </Stack>

                  {commit.error && (
                    <Alert severity="error">
                      {commit.error.message}
                      {commit.error instanceof ApiError && commit.error.code === 'VALIDATION_ERROR' && ' Tick "skip" above or fix the file.'}
                    </Alert>
                  )}
                  <Stack direction="row" gap={1}>
                    <Button variant="contained" disabled={!canImport || commit.isPending} onClick={() => commit.mutate()}>
                      {commit.isPending ? 'Importing...' : `Import ${p.validRows} guest${p.validRows === 1 ? '' : 's'}`}
                    </Button>
                    <Button onClick={() => nav(eventId ? `/events/${eventId}?tab=guests` : '/guests')}>Cancel</Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      )}
    </>
  );
}
