sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    let _dialog = null;
    let _deliveryDoc = null;

    const handler = {

        // Called from DeliveryMap.js to open the dialog
        openDialog: function (deliveryDoc, existingQrImage) {
            _deliveryDoc = deliveryDoc;
            handler._getDialog().then(function (oDialog) {
                // Reset form
                handler._find("inputTruckReg").setValue("");
                handler._find("inputMobile").setValue("");
                handler._find("assignErrorStrip").setVisible(false);

                if (existingQrImage) {
                    // Show QR immediately (getQRCode flow)
                    handler._showQR(existingQrImage);
                } else {
                    // Show assignment form
                    handler._find("assignForm").setVisible(true);
                    handler._find("qrSection").setVisible(false);
                    handler._find("btnAssign").setVisible(true);
                }
                oDialog.open();
            });
        },

        onAssign: function () {
            const mobile = handler._find("inputMobile").getValue().trim();
            const truck  = handler._find("inputTruckReg").getValue().trim() || null;

            if (!mobile) {
                const strip = handler._find("assignErrorStrip");
                strip.setText("Mobile Number is required.");
                strip.setVisible(true);
                return;
            }

            handler._find("btnAssign").setEnabled(false);

            // POST assignDriver action
            fetch("/odata/v4/tracking/assignDriver", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa("alice:alice")
                },
                body: JSON.stringify({
                    deliveryDoc: _deliveryDoc,
                    mobileNumber: mobile,
                    truckRegistration: truck
                })
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        const msg = (data && data.error && data.error.message) || "Assignment failed";
                        throw new Error(msg);
                    }
                    return data;
                });
            }).then(function (assignment) {
                handler._showQR(assignment.QRCodeImage);
            }).catch(function (err) {
                const strip = handler._find("assignErrorStrip");
                strip.setText(err.message || "Failed to assign driver");
                strip.setVisible(true);
                handler._find("btnAssign").setEnabled(true);
            });
        },

        onCloseDialog: function () {
            handler._getDialog().then(function (oDialog) { oDialog.close(); });
        },

        _showQR: function (qrImageBase64) {
            handler._find("assignForm").setVisible(false);
            handler._find("btnAssign").setVisible(false);
            handler._find("qrSection").setVisible(true);
            // Inject base64 img into the HTML control
            const container = document.getElementById("qrImageContainer");
            if (container) {
                container.innerHTML = '<img src="' + qrImageBase64 + '" style="display:block;margin:12px auto;max-width:220px;" alt="QR Code"/>';
            }
        },

        _getDialog: function () {
            if (_dialog) return Promise.resolve(_dialog);
            return sap.ui.core.Fragment.load({
                name: "ewm.deliveries.ext.fragment.DriverAssign",
                controller: handler
            }).then(function (oDialog) {
                _dialog = oDialog;
                return oDialog;
            });
        },

        _find: function (sLocalId) {
            const el = document.querySelector('[id$="--' + sLocalId + '"]');
            if (!el) return null;
            const fullId = el.id.replace(/^sap-ui-invisible-/, "");
            return sap.ui.getCore().byId(fullId) || null;
        }
    };

    return handler;
});
