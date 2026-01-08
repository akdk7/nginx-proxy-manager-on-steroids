import { useState } from "react";
import { T } from "src/locale";
import BlockExploits from "./BlockExploits";
import DefaultSite from "./DefaultSite";
import GeoAccess from "./GeoAccess";
import ProxyProtocol from "./ProxyProtocol";

export default function Layout() {
	// Taken from https://preview.tabler.io/settings.html
	// Refer to that when updating this content
	const [activeSection, setActiveSection] = useState<
		"default-site" | "proxy-protocol" | "geo-access" | "block-exploits"
	>("default-site");

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-teal" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<h2 className="mt-1 mb-0">
							<T id="settings" />
						</h2>
					</div>
				</div>
				<div className="row g-0">
					<div className="col-12 col-md-3 border-end">
						<div className="card-body mt-0 pt-0">
							<div className="list-group list-group-transparent">
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										activeSection === "default-site" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveSection("default-site");
									}}
								>
									<T id="settings.default-site" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										activeSection === "proxy-protocol" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveSection("proxy-protocol");
									}}
								>
									<T id="settings.proxy-protocol" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										activeSection === "geo-access" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveSection("geo-access");
									}}
								>
									<T id="settings.geo-access" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										activeSection === "block-exploits" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveSection("block-exploits");
									}}
								>
									<T id="settings.block-exploits" />
								</a>
							</div>
						</div>
					</div>
					<div className="col-12 col-md-9 d-flex flex-column">
						{activeSection === "default-site" ? (
							<DefaultSite />
						) : activeSection === "proxy-protocol" ? (
							<ProxyProtocol />
						) : activeSection === "geo-access" ? (
							<GeoAccess />
						) : (
							<BlockExploits />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
