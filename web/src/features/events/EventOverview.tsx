import { Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorAlert, StatCard } from '../../components/ui';
import { formatTime } from '../../lib/utils/format';
import { useEventStats } from './api';

const RSVP_COLORS = { Confirmed: '#2e7d32', Declined: '#c62828', Pending: '#9e9e9e' };
const PALETTE = ['#1565c0', '#6a1b9a', '#00838f', '#ef6c00', '#ad1457', '#558b2f', '#455a64'];

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography fontWeight={700} mb={1}>{title}</Typography>
        {empty ? <Typography color="text.secondary" py={6} textAlign="center">No data yet</Typography> : <div style={{ width: '100%', height: 240 }}>{children}</div>}
      </CardContent>
    </Card>
  );
}

export function EventOverview({ eventId }: { eventId: string }) {
  const q = useEventStats(eventId);
  const s = q.data;
  const rsvp = s
    ? [
        { name: 'Confirmed', value: s.rsvpConfirmed },
        { name: 'Declined', value: s.rsvpDeclined },
        { name: 'Pending', value: s.rsvpPending },
      ].filter((d) => d.value > 0)
    : [];
  return (
    <Stack gap={3}>
      <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      <Grid container spacing={2}>
        {[
          ['Total invited', s?.totalInvited],
          ['RSVP confirmed', s?.rsvpConfirmed],
          ['RSVP declined', s?.rsvpDeclined],
          ['Pending RSVP', s?.rsvpPending],
          ['Checked in', s?.checkedIn],
          ['Not checked in', s?.notCheckedIn],
          ['Attendance', s ? `${s.attendancePct}%` : undefined],
        ].map(([label, value]) => (
          <Grid item xs={6} sm={4} md={3} lg key={label as string}>
            <StatCard label={label as string} value={value ?? 0} loading={q.isLoading} color={label === 'Checked in' ? 'success.main' : undefined} />
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <ChartCard title="RSVP distribution" empty={rsvp.length === 0}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={rsvp} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {rsvp.map((d) => <Cell key={d.name} fill={RSVP_COLORS[d.name as keyof typeof RSVP_COLORS]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <ChartCard title="Check-ins over time" empty={!s || s.checkinsOverTime.length === 0}>
            <ResponsiveContainer>
              <BarChart data={s?.checkinsOverTime.map((d) => ({ time: formatTime(d.bucket).replace(/:\d\d(?=\s|$)/, ''), count: d.count }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Check-ins" fill="#1565c0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <ChartCard title="Guest categories" empty={!s || s.categories.length === 0}>
            <ResponsiveContainer>
              <BarChart data={s?.categories} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="category" fontSize={12} width={80} />
                <Tooltip />
                <Bar dataKey="count" name="Guests" radius={[0, 4, 4, 0]}>
                  {s?.categories.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <ChartCard title="Check-ins by gate" empty={!s || s.gates.length === 0}>
            <ResponsiveContainer>
              <BarChart data={s?.gates}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="gate" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Check-ins" fill="#00838f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>
    </Stack>
  );
}
