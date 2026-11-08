import { screen, within } from '@testing-library/react';
import type { Role, SupportTicket } from '@gymverse/shared';
import { Support } from './Support';
import { installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { SUPPORT_INFO, makeTicket } from '../test/fixtures2';
import { renderUi } from '../test/render';

function setup(role: Role = 'owner') {
  let ticket: SupportTicket = makeTicket();
  const fake = installFakeApi({
    'GET /gyms/:gymId/support/tickets': (req) => ({
      tickets: [ticket, makeTicket({ id: 't-2', subject: 'Locker key lost', status: 'answered' })].filter(
        (t) => !req.query.get('status') || t.status === req.query.get('status'),
      ),
    }),
    'GET /gyms/:gymId/support/tickets/:id': () => ticket,
    'POST /gyms/:gymId/support/tickets/:id/messages': (req) => {
      ticket = {
        ...ticket,
        status: 'answered',
        messages: [
          ...ticket.messages,
          { id: 'm-2', from: 'staff', author: { id: 'user-owner', name: 'Priya Sharma' }, body: (req.body as { body: string }).body, at: '2026-11-07T10:00:00.000Z' },
        ],
      };
      return ticket;
    },
    'PATCH /gyms/:gymId/support/tickets/:id': (req) => {
      ticket = { ...ticket, status: (req.body as { status: SupportTicket['status'] }).status };
      return ticket;
    },
    'GET /gyms/:gymId/support': SUPPORT_INFO,
    'PUT /gyms/:gymId/support': (req) => req.body as object,
  });
  return { ...renderUi(<Support gym={makeGym()} role={role} />), fake };
}

describe('Support inbox', () => {
  it('filters tickets by status', async () => {
    const { user, fake } = setup();
    expect(await screen.findAllByTestId('ticket')).toHaveLength(1);
    expect(fake.callsTo('GET /gyms/:gymId/support/tickets')[0].query.get('status')).toBe('open');
    await user.click(screen.getByRole('tab', { name: 'Answered' }));
    expect(await screen.findByText('Locker key lost')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('Freeze my membership');
    expect(screen.getAllByTestId('ticket')).toHaveLength(2);
    expect(fake.callsTo('GET /gyms/:gymId/support/tickets').at(-1)!.query.get('status')).toBeNull();
  });

  it('opens a thread, replies and closes the ticket', async () => {
    const { user, fake } = setup();
    await user.click(await screen.findByRole('button', { name: /Freeze my membership/ }));
    const thread = await screen.findByRole('region', { name: 'Ticket: Freeze my membership' });
    expect(within(thread).getByText('I am travelling for 2 weeks.')).toBeInTheDocument();

    await user.click(within(thread).getByRole('button', { name: 'Send reply' }));
    expect(within(thread).getByRole('alert')).toHaveTextContent('Write a reply first.');
    await user.type(within(thread).getByLabelText('Reply'), 'Done, frozen until the 20th.');
    await user.click(within(thread).getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('Reply sent')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/support/tickets/:id/messages')[0]).toMatchObject({
      params: { id: 't-1' },
      body: { body: 'Done, frozen until the 20th.' },
    });
    expect(within(thread).getAllByTestId('ticket-message')).toHaveLength(2);
    expect(within(thread).getByText('Priya Sharma (staff)')).toBeInTheDocument();
    expect(within(thread).getByLabelText('Reply')).toHaveValue('');
    // The list entry follows the thread's new status.
    expect(within(screen.getByRole('button', { name: /Freeze my membership/ })).getByText('Answered')).toBeInTheDocument();

    await user.click(within(thread).getByRole('button', { name: 'Close ticket' }));
    expect(await screen.findByText('Ticket closed')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /gyms/:gymId/support/tickets/:id')[0].body).toEqual({ status: 'closed' });
    expect(within(thread).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('trainers can reply but not close, and do not see the help-info editor', async () => {
    const { user } = setup('trainer');
    expect(screen.queryByRole('tab', { name: 'Help info & FAQs' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Freeze my membership/ }));
    const thread = await screen.findByRole('region', { name: 'Ticket: Freeze my membership' });
    expect(within(thread).getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(within(thread).queryByRole('button', { name: 'Close ticket' })).not.toBeInTheDocument();
  });
});

describe('Support info', () => {
  it('edits contact details and FAQs and saves with PUT', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: 'Help info & FAQs' }));
    const form = await screen.findByRole('form', { name: 'Support info' });
    expect(within(form).getByLabelText('Phone')).toHaveValue('+919999900001');
    expect(within(form).getByLabelText('Question 1')).toHaveValue('Is parking free?');

    await user.type(within(form).getByLabelText('WhatsApp'), '+91 98765 43210');
    await user.type(within(form).getByLabelText('Opening hours'), 'Mon–Sat 6am–10pm');
    await user.click(within(form).getByRole('button', { name: 'Add question' }));
    await user.type(within(form).getByLabelText('Question 2'), 'Can I freeze my plan?');
    await user.type(within(form).getByLabelText('Answer 2'), 'Yes, up to 30 days a year.');
    await user.click(within(form).getByRole('button', { name: 'Move question 2 up' }));

    // Bad email is caught by the shared schema.
    await user.type(within(form).getByLabelText('Email'), 'nope');
    await user.click(within(form).getByRole('button', { name: 'Save support info' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Email');
    expect(fake.callsTo('PUT /gyms/:gymId/support')).toHaveLength(0);
    await user.clear(within(form).getByLabelText('Email'));

    await user.click(within(form).getByRole('button', { name: 'Save support info' }));
    expect(await screen.findByText('Help & support info saved')).toBeInTheDocument();
    expect(fake.callsTo('PUT /gyms/:gymId/support')[0].body).toEqual({
      phone: '+919999900001',
      whatsapp: '+91 98765 43210',
      email: null,
      address: 'FC Road, Pune',
      hours: 'Mon–Sat 6am–10pm',
      faqs: [
        { q: 'Can I freeze my plan?', a: 'Yes, up to 30 days a year.' },
        { q: 'Is parking free?', a: 'Yes, for members.' },
      ],
    });
  });

  it('removes an FAQ', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: 'Help info & FAQs' }));
    const form = await screen.findByRole('form', { name: 'Support info' });
    await user.click(within(form).getByRole('button', { name: 'Remove question 1' }));
    expect(within(form).queryByTestId('faq')).not.toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save support info' }));
    await screen.findByText('Help & support info saved');
    expect((fake.callsTo('PUT /gyms/:gymId/support')[0].body as { faqs: unknown[] }).faqs).toEqual([]);
  });
});
