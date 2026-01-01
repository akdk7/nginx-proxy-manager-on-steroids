/// <reference types="cypress" />

describe('Proxy Hosts endpoints', () => {
	let token;

	before(() => {
		cy.resetUsers();
		cy.getToken().then((tok) => {
			token = tok;
		});
	});

	it('Should be able to create a http host', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  '/api/nginx/proxy-hosts',
			data:  {
				domain_names:   ['test.example.com'],
				forward_scheme: 'http',
				forward_host:   '1.1.1.1',
				forward_port:   80,
				access_list_id: '0',
				certificate_id: 0,
				meta:           {
					dns_challenge: false
				},
				advanced_config:         '',
				locations:               [],
				block_exploits:          false,
				caching_enabled:         false,
				allow_websocket_upgrade: false,
				http2_support:           false,
				hsts_enabled:            false,
				hsts_subdomains:         false,
				ssl_forced:              false
			}
		}).then((data) => {
			cy.validateSwaggerSchema('post', 201, '/nginx/proxy-hosts', data);
			expect(data).to.have.property('id');
			expect(data.id).to.be.greaterThan(0);
			expect(data).to.have.property('enabled');
			expect(data).to.have.property("enabled", true);
			expect(data).to.have.property('meta');
			expect(typeof data.meta.nginx_online).to.be.equal('undefined');
		});
	});

	it('Should be able to create a host with upstream servers', () => {
		cy.task('backendApiPost', {
			token: token,
			path:  '/api/nginx/proxy-hosts',
			data:  {
				domain_names:   ['upstream.example.com'],
				forward_scheme: 'http',
				forward_host:   '1.1.1.1',
				forward_port:   8081,
				access_list_id: '0',
				certificate_id: 0,
				meta:           {
					dns_challenge: false
				},
				advanced_config:            '',
				locations:                  [],
				block_exploits:             false,
				caching_enabled:            false,
				allow_websocket_upgrade:    false,
				http2_support:              false,
				hsts_enabled:               false,
				hsts_subdomains:            false,
				ssl_forced:                 false,
				upstream_enabled:           true,
				upstream_policy:            'round_robin',
				upstream_servers:           [
					{
						host:         '1.1.1.1',
						port:         8081,
						weight:       1,
						max_fails:    0,
						fail_timeout: 0,
						backup:       false
					}
				],
				upstream_ssl_certificate_id: 0
			}
		}).then((data) => {
			cy.validateSwaggerSchema('post', 201, '/nginx/proxy-hosts', data);
			expect(data).to.have.property('upstream_enabled', true);
			expect(data).to.have.property('upstream_policy', 'round_robin');
			expect(data).to.have.property('upstream_servers');
			expect(data.upstream_servers).to.have.length(1);
		});
	});

});
