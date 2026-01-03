# This is a Dockerfile intended to be built using `docker buildx`
# for multi-arch support. Building with `docker build` may have unexpected results.

# This file assumes that the frontend has been built using ./scripts/frontend-build

ARG NGINX_IMAGE=nginxproxymanager/nginx-full:certbot-node
ARG NGINX_VERSION
ARG HTTP3_OPENSSL_REPO=https://github.com/quictls/openssl
ARG HTTP3_OPENSSL_REF=OpenSSL_1_1_1w+quic
ARG GEOIP2_MODULE_REPO=https://github.com/leev/ngx_http_geoip2_module
ARG GEOIP2_MODULE_REF

FROM ${NGINX_IMAGE} AS nginx-http3-build
ARG NGINX_VERSION
ARG HTTP3_OPENSSL_REPO
ARG HTTP3_OPENSSL_REF
ARG GEOIP2_MODULE_REPO
ARG GEOIP2_MODULE_REF

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		libpcre3-dev \
		libmaxminddb-dev \
		zlib1g-dev \
		perl \
		pkg-config \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

RUN set -eux; \
	nginx_version="${NGINX_VERSION:-$(/usr/sbin/nginx -v 2>&1 | awk -F/ '{print $2}')}"; \
	mkdir -p /tmp/nginx-http3; \
	if ! curl -fsSL "https://nginx.org/download/nginx-${nginx_version}.tar.gz" | tar -xz -C /tmp/nginx-http3; then \
		nginx_version_fallback="${nginx_version%.*}"; \
		if [ "${nginx_version_fallback}" = "${nginx_version}" ]; then \
			exit 1; \
		fi; \
		curl -fsSL "https://nginx.org/download/nginx-${nginx_version_fallback}.tar.gz" | tar -xz -C /tmp/nginx-http3; \
		nginx_version="${nginx_version_fallback}"; \
	fi; \
	git clone --depth 1 --branch "${HTTP3_OPENSSL_REF}" "${HTTP3_OPENSSL_REPO}" /tmp/nginx-http3/openssl; \
	if [ -n "${GEOIP2_MODULE_REF}" ]; then \
		git clone --depth 1 --branch "${GEOIP2_MODULE_REF}" "${GEOIP2_MODULE_REPO}" /tmp/nginx-http3/ngx_http_geoip2_module; \
	else \
		git clone --depth 1 "${GEOIP2_MODULE_REPO}" /tmp/nginx-http3/ngx_http_geoip2_module; \
	fi; \
	cd "/tmp/nginx-http3/nginx-${nginx_version}"; \
	./configure \
		--prefix=/usr \
		--sbin-path=/usr/sbin/nginx \
		--conf-path=/etc/nginx/nginx.conf \
		--modules-path=/usr/lib/nginx/modules \
		--pid-path=/run/nginx/nginx.pid \
		--error-log-path=/var/log/nginx/error.log \
		--http-log-path=/var/log/nginx/access.log \
		--with-compat \
		--with-http_ssl_module \
		--with-http_v2_module \
		--with-http_v3_module \
		--with-http_realip_module \
		--with-http_stub_status_module \
		--with-http_gzip_static_module \
		--with-http_auth_request_module \
		--with-http_secure_link_module \
		--with-http_slice_module \
		--with-http_sub_module \
		--with-http_addition_module \
		--with-http_dav_module \
		--with-http_flv_module \
		--with-http_mp4_module \
		--with-http_random_index_module \
		--with-http_degradation_module \
		--with-stream \
		--with-stream_ssl_module \
		--with-stream_ssl_preread_module \
		--add-dynamic-module=/tmp/nginx-http3/ngx_http_geoip2_module \
		--with-openssl=/tmp/nginx-http3/openssl \
		--with-openssl-opt=enable-tls1_3; \
	make -j"$(nproc)"; \
	make modules; \
	make install DESTDIR=/tmp/nginx-http3/install

FROM nginxproxymanager/testca AS testca
FROM ${NGINX_IMAGE}

ARG TARGETPLATFORM
ARG BUILD_VERSION
ARG BUILD_COMMIT
ARG BUILD_DATE

# See: https://github.com/just-containers/s6-overlay/blob/master/README.md
ENV SUPPRESS_NO_CONFIG_WARNING=1 \
	S6_BEHAVIOUR_IF_STAGE2_FAILS=1 \
	S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
	S6_FIX_ATTRS_HIDDEN=1 \
	S6_KILL_FINISH_MAXTIME=10000 \
	S6_VERBOSITY=1 \
	NODE_ENV=production \
	NPM_BUILD_VERSION="${BUILD_VERSION}" \
	NPM_BUILD_COMMIT="${BUILD_COMMIT}" \
	NPM_BUILD_DATE="${BUILD_DATE}" \
	NODE_OPTIONS="--openssl-legacy-provider"

RUN echo "fs.file-max = 65535" > /etc/sysctl.conf \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends jq logrotate libmaxminddb0 \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# s6 overlay
COPY docker/scripts/install-s6 /tmp/install-s6
RUN /tmp/install-s6 "${TARGETPLATFORM}" && rm -f /tmp/install-s6

COPY --from=nginx-http3-build /tmp/nginx-http3/install/usr/sbin/nginx /usr/sbin/nginx
COPY --from=nginx-http3-build /tmp/nginx-http3/install/usr/lib/nginx/modules/ngx_http_geoip2_module.so /usr/lib/nginx/modules/
COPY --from=nginx-http3-build /tmp/nginx-http3/install/usr/lib/nginx/modules/ngx_stream_geoip2_module.so /usr/lib/nginx/modules/
EXPOSE 80 81 443 443/udp

COPY backend       /app
COPY frontend/dist /app/frontend

WORKDIR /app
RUN yarn install \
	&& yarn cache clean

# add late to limit cache-busting by modifications
COPY docker/rootfs /
COPY --from=testca /home/step/certs/root_ca.crt /etc/ssl/certs/NginxProxyManager.crt

# Remove frontend service not required for prod, dev nginx config as well
RUN rm -rf /etc/s6-overlay/s6-rc.d/user/contents.d/frontend /etc/nginx/conf.d/dev.conf \
	&& chmod 644 /etc/logrotate.d/nginx-proxy-manager

VOLUME [ "/data" ]
ENTRYPOINT [ "/init" ]

LABEL org.label-schema.schema-version="1.0" \
	org.label-schema.license="MIT" \
	org.label-schema.name="nginx-proxy-manager" \
	org.label-schema.description="Docker container for managing Nginx proxy hosts with a simple, powerful interface " \
	org.label-schema.url="https://github.com/jc21/nginx-proxy-manager" \
	org.label-schema.vcs-url="https://github.com/jc21/nginx-proxy-manager.git" \
	org.label-schema.cmd="docker run --rm -ti jc21/nginx-proxy-manager:latest"
