import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '../../api/client';
import { makeFakeApi, renderApp, supportFixture, ticketFixture } from '../../test/fakeApi';
import { NewTicketScreen, SupportScreen, TicketScreen } from './SupportScreens';

describe('Support', () => {
  let open: jest.SpyInstance;
  beforeEach(() => {
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => open.mockRestore());

  it('shows contact buttons, hours and address, and opens each app', async () => {
    renderApp(<SupportScreen />);
    expect(await screen.findByText('Talk to Flex Fitness')).toBeTruthy();
    expect(screen.getByText('Mon–Sat 5am–11pm, Sun 6am–12pm')).toBeTruthy();
    expect(screen.getByText('FC Road, Pune')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Call'));
    expect(open).toHaveBeenLastCalledWith('tel:+919820000000');
    fireEvent.press(screen.getByLabelText('WhatsApp'));
    expect(open).toHaveBeenLastCalledWith('https://wa.me/919820000000');
    fireEvent.press(screen.getByLabelText('Email'));
    expect(open).toHaveBeenLastCalledWith('mailto:hello@flexfitness.in');
  });

  it('only shows the contact options the gym set', async () => {
    const api = makeFakeApi({ supportInfo: async () => supportFixture({ phone: null, email: null, faqs: [] }) });
    renderApp(<SupportScreen />, { api });
    expect(await screen.findByLabelText('WhatsApp')).toBeTruthy();
    expect(screen.queryByLabelText('Call')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByText('Common questions')).toBeNull();
  });

  it('expands an FAQ answer', async () => {
    renderApp(<SupportScreen />);
    const q = await screen.findByLabelText('Can I freeze my membership?');
    expect(screen.queryByText('Yes, up to 30 days a year. Ask at the front desk.')).toBeNull();
    fireEvent.press(q);
    expect(screen.getByText('Yes, up to 30 days a year. Ask at the front desk.')).toBeTruthy();
    expect(screen.getByLabelText('Can I freeze my membership?').props.accessibilityState.expanded).toBe(true);
    fireEvent.press(screen.getByLabelText('Can I freeze my membership?'));
    expect(screen.queryByText('Yes, up to 30 days a year. Ask at the front desk.')).toBeNull();
  });

  it('lists conversations with status and opens one, and starts a new message', async () => {
    const { nav } = renderApp(<SupportScreen />);
    const row = await screen.findByTestId('ticket-t1');
    expect(within(row).getByText('Locker key lost')).toBeTruthy();
    expect(within(row).getByText('Gym replied')).toBeTruthy();
    fireEvent.press(row);
    expect(nav().stack.at(-1)).toMatchObject({ name: 'Ticket', params: { id: 't1' } });
    fireEvent.press(screen.getByLabelText('Message the gym'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'NewTicket' });
  });

  it('shows the API error', async () => {
    const api = makeFakeApi({
      supportInfo: async () => {
        throw new ApiError(403, 'feature_disabled', 'Help & support is switched off at this gym.');
      },
    });
    renderApp(<SupportScreen />, { api });
    expect(await screen.findByText('Help & support is switched off at this gym.')).toBeTruthy();
  });
});

describe('New ticket', () => {
  it('validates, creates the ticket and replaces itself with the conversation', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<NewTicketScreen />, { api });
    await screen.findByLabelText('Subject');
    act(() => nav().push('NewTicket'));

    fireEvent.press(screen.getByLabelText('Send message'));
    expect(screen.getByText('Add a short subject.')).toBeTruthy();
    expect(screen.getByText('Write your message.')).toBeTruthy();
    expect(api.createTicket).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Subject'), 'Shower is cold');
    fireEvent.changeText(screen.getByLabelText('Message'), 'The men’s shower has no hot water.');
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => expect(api.createTicket).toHaveBeenCalledWith('gym-1', 'Shower is cold', 'The men’s shower has no hot water.'));
    await waitFor(() => expect(nav().stack).toHaveLength(1));
    expect(nav().stack[0]).toMatchObject({ name: 'Ticket', params: { id: 't-new' } });
  });
});

describe('Ticket', () => {
  it('shows the chat, sends a reply and marks it resolved', async () => {
    const api = makeFakeApi();
    renderApp(<TicketScreen params={{ id: 't1' }} />, { api });
    expect(await screen.findByText('I lost my locker key.')).toBeTruthy();
    expect(screen.getByLabelText('You: I lost my locker key.')).toBeTruthy();
    expect(screen.getByLabelText('Priya Sharma: No problem, collect a spare at the desk.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Your message'), 'Thanks, got it!');
    fireEvent.press(screen.getByLabelText('Send'));
    expect(await screen.findByText('Thanks, got it!')).toBeTruthy();
    expect(api.replyTicket).toHaveBeenCalledWith('gym-1', 't1', 'Thanks, got it!');
    expect(screen.getByText('Waiting for the gym')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Mark as resolved'));
    await waitFor(() => expect(api.setTicketStatus).toHaveBeenCalledWith('gym-1', 't1', 'closed'));
    expect(await screen.findByText('Resolved')).toBeTruthy();
    expect(screen.queryByLabelText('Mark as resolved')).toBeNull();
    expect(screen.getByText('This conversation is resolved. Send a message to reopen it.')).toBeTruthy();
  });

  it('reopens a resolved conversation by replying', async () => {
    const api = makeFakeApi({ ticket: async (_g: string, id: string) => ticketFixture({ id, status: 'closed' }) });
    renderApp(<TicketScreen params={{ id: 't1' }} />, { api });
    expect(await screen.findByText('Resolved')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your message'), 'It happened again');
    fireEvent.press(screen.getByLabelText('Send'));
    expect(await screen.findByText('Waiting for the gym')).toBeTruthy();
    expect(screen.getByLabelText('Mark as resolved')).toBeTruthy();
  });

  it('does not send an empty reply', async () => {
    const api = makeFakeApi();
    renderApp(<TicketScreen params={{ id: 't1' }} />, { api });
    fireEvent.press(await screen.findByLabelText('Send'));
    expect(screen.getByText('Write a message first.')).toBeTruthy();
    expect(api.replyTicket).not.toHaveBeenCalled();
  });
});
