ARG NGINX_IMAGE=nginxproxymanager/nginx-full:certbot-node
ARG NGINX_VERSION
ARG HTTP3_OPENSSL_REPO=https://github.com/quictls/openssl
ARG HTTP3_OPENSSL_REF=OpenSSL_1_1_1w+quic

FROM ${NGINX_IMAGE} AS nginx-http3-build
ARG NGINX_VERSION
ARG HTTP3_OPENSSL_REPO
ARG HTTP3_OPENSSL_REF

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		libpcre3-dev \
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
		--with-openssl=/tmp/nginx-http3/openssl \
		--with-openssl-opt=enable-tls1_3; \
	make -j"$(nproc)"; \
	make install DESTDIR=/tmp/nginx-http3/install

FROM nginxproxymanager/testca AS testca
FROM ${NGINX_IMAGE}
LABEL maintainer="Jamie Curnow <jc@jc21.com>"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV SUPPRESS_NO_CONFIG_WARNING=1 \
	S6_BEHAVIOUR_IF_STAGE2_FAILS=1 \
	S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
	S6_FIX_ATTRS_HIDDEN=1 \
	S6_KILL_FINISH_MAXTIME=10000 \
	S6_VERBOSITY=2 \
	NODE_OPTIONS="--openssl-legacy-provider"

RUN echo "fs.file-max = 65535" > /etc/sysctl.conf \
	&& apt-get update \
	&& apt-get install -y jq python3-pip logrotate moreutils \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# Task
WORKDIR /usr
RUN curl -sL https://taskfile.dev/install.sh | sh
WORKDIR /root

COPY --from=nginx-http3-build /tmp/nginx-http3/install/usr/sbin/nginx /usr/sbin/nginx
COPY --from=nginx-http3-build /tmp/nginx-http3/install/usr/lib/nginx /usr/lib/nginx

COPY rootfs /
COPY scripts/install-s6 /tmp/install-s6
RUN rm -f /etc/nginx/conf.d/production.conf \
	&& chmod 644 /etc/logrotate.d/nginx-proxy-manager \
	&& /tmp/install-s6 "${TARGETPLATFORM}" \
	&& rm -f /tmp/install-s6 \
	&& chmod 644 -R /root/.cache

# Certs for testing purposes
COPY --from=testca /home/step/certs/root_ca.crt /etc/ssl/certs/NginxProxyManager.crt

EXPOSE 80 81 443 443/udp
ENTRYPOINT [ "/init" ]
