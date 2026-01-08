import type { AppVersion, User } from "./models";

export interface HealthResponse {
	status: string;
	version: AppVersion;
	setup: boolean;
	nginx?: {
		http3Supported: boolean;
	};
}

export interface TokenResponse {
	expires: number;
	token: string;
}

export interface ValidatedCertificateResponse {
	certificate?: {
		cn: string;
		issuer: string;
		dates: {
			from: number;
			to: number;
		};
	};
	certificateKey?: boolean;
	certificateKeyMatches?: boolean;
	intermediateCertificate?: {
		cn: string;
		issuer: string;
		dates: {
			from: number;
			to: number;
		};
	};
}

export interface LoginAsTokenResponse extends TokenResponse {
	user: User;
}
