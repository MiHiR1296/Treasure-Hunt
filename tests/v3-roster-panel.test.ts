import test from 'node:test';
import assert from 'node:assert/strict';
import { organizerTeamCreationAvailability } from '../components/v3/admin/RosterPanel';

test('organizer team creation follows the live registration switch', () => {
  assert.deepEqual(organizerTeamCreationAvailability({ status: 'ready', registrationOpen: true }), {
    allowed: true,
    message: '',
  });
  assert.deepEqual(organizerTeamCreationAvailability({ status: 'live', registrationOpen: false }), {
    allowed: false,
    message: 'Team creation is closed. Reopen it in Event lifecycle; existing teams can still join and check in.',
  });
  assert.equal(organizerTeamCreationAvailability({ status: 'paused', registrationOpen: true }).allowed, true);
});

test('organizer team creation remains unavailable after event end regardless of its saved switch', () => {
  for (const registrationOpen of [true, false]) {
    assert.deepEqual(organizerTeamCreationAvailability({ status: 'ended', registrationOpen }), {
      allowed: false,
      message: 'Team creation is unavailable after this event has ended.',
    });
  }
});
