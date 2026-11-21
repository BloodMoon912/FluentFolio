import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSameOriginRequest } from '../src/lib/request-security.ts';

describe('isSameOriginRequest', () => {
  it('accepts the exact request origin', () => {
    const request = new Request('https://cms.example.com/api/admin/content', {
      method: 'POST',
      headers: { origin: 'https://cms.example.com' },
    });
    assert.equal(isSameOriginRequest(request), true);
  });

  it('rejects a different origin', () => {
    const request = new Request('https://cms.example.com/api/admin/content', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(isSameOriginRequest(request), false);
  });

  it('rejects a missing origin', () => {
    const request = new Request('https://cms.example.com/api/admin/content', { method: 'POST' });
    assert.equal(isSameOriginRequest(request), false);
  });

  it('rejects the opaque "null" origin', () => {
    const request = new Request('https://cms.example.com/api/admin/content', {
      method: 'POST',
      headers: { origin: 'null' },
    });
    assert.equal(isSameOriginRequest(request), false);
  });

  it('rejects malformed origins', () => {
    for (const origin of [
      'not a URL',
      '',
      'cms.example.com',
      '://cms.example.com',
      'https://cms.example.com, https://attacker.example',
    ]) {
      const request = new Request('https://cms.example.com/api/admin/content', {
        method: 'POST',
        headers: { origin },
      });
      assert.equal(isSameOriginRequest(request), false, `should reject "${origin}"`);
    }
  });

  it('rejects scheme downgrades and lookalike hosts', () => {
    for (const origin of [
      'http://cms.example.com',
      'https://cms.example.com.attacker.example',
      'https://evilcms.example.com',
      'https://cms.example.com@attacker.example',
    ]) {
      const request = new Request('https://cms.example.com/api/admin/content', {
        method: 'POST',
        headers: { origin },
      });
      assert.equal(isSameOriginRequest(request), false, `should reject "${origin}"`);
    }
  });

  it('treats ports as part of the origin', () => {
    const request = new Request('https://cms.example.com:8443/api/admin/content', {
      method: 'POST',
      headers: { origin: 'https://cms.example.com' },
    });
    assert.equal(isSameOriginRequest(request), false);
  });

  it('accepts the URL-parseable form of the same origin', () => {
    // The Origin header is serialised without a path and with the default port
    // elided; a client that includes them still denotes the same origin.
    for (const origin of ['https://cms.example.com/', 'https://cms.example.com:443']) {
      const request = new Request('https://cms.example.com/api/admin/content', {
        method: 'POST',
        headers: { origin },
      });
      assert.equal(isSameOriginRequest(request), true, origin);
    }
  });

  it('does not fall back to the Referer header', () => {
    const request = new Request('https://cms.example.com/api/admin/content', {
      method: 'POST',
      headers: { referer: 'https://cms.example.com/admin' },
    });
    assert.equal(isSameOriginRequest(request), false);
  });
});
