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
                oDialog.byId("inputTruckReg").setValue("");
                oDialog.byId("inputMobile").setValue("");
                oDialog.byId("assignErrorStrip").setVisible(false);

                if (existingQrImage) {
                    handler._showQR(oDialog, existingQrImage);
                } else {
                    oDialog.byId("assignForm").setVisible(true);
                    oDialog.byId("qrSection").setVisible(false);
                    oDialog.byId("btnAssign").setVisible(true);
                }
                oDialog.open();
            });
        },

        onAssign: function () {
            handler._getDialog().then(function (oDialog) {
                const mobile = oDialog.byId("inputMobile").getValue().trim();
                const truck  = oDialog.byId("inputTruckReg").getValue().trim() || null;

                if (!mobile) {
                    const strip = oDialog.byId("assignErrorStrip");
                    strip.setText("Mobile Number is required.");
                    strip.setVisible(true);
                    return;
                }

                oDialog.byId("btnAssign").setEnabled(false);

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
                    handler._showQR(oDialog, assignment.QRCodeImage);
                }).catch(function (err) {
                    const strip = oDialog.byId("assignErrorStrip");
                    strip.setText(err.message || "Failed to assign driver");
                    strip.setVisible(true);
                    oDialog.byId("btnAssign").setEnabled(true);
                });
            });
        },

        onCloseDialog: function () {
            handler._getDialog().then(function (oDialog) { oDialog.close(); });
        },

        _showQR: function (oDialog, qrImageBase64) {
            oDialog.byId("assignForm").setVisible(false);
            oDialog.byId("btnAssign").setVisible(false);
            oDialog.byId("qrSection").setVisible(true);
            const htmlCtrl = oDialog.byId("qrImageHtml");
            if (htmlCtrl) {
                htmlCtrl.setContent('<div style="text-align:center;padding:8px"><img src="' + qrImageBase64 + '" style="max-width:220px;display:block;margin:0 auto;" alt="QR Code"/></div>');
            }
        },

        _getDialog: function () {
            if (_dialog) return Promise.resolve(_dialog);
            return sap.ui.core.Fragment.load({
                id: "driverAssignFrag",
                name: "ewm.deliveries.ext.fragment.DriverAssign",
                controller: handler
            }).then(function (oDialog) {
                _dialog = oDialog;
                return oDialog;
            });
        }
    };

    return handler;
});
