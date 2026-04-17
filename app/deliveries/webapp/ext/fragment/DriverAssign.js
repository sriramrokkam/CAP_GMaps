sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/core/Fragment"
], function (MessageToast, Fragment) {
    "use strict";

    var _dialog = null;
    var _deliveryDoc = null;

    function _byId(sId) {
        return Fragment.byId("driverAssignFrag", sId);
    }

    var handler = {

        openDialog: function (deliveryDoc, existingQrImage, existingQrUrl) {
            _deliveryDoc = deliveryDoc;
            handler._getDialog().then(function (oDialog) {
                var inputTruck = _byId("inputTruckReg");
                var inputMobile = _byId("inputMobile");
                var errorStrip = _byId("assignErrorStrip");

                if (inputTruck) inputTruck.setValue("");
                if (inputMobile) inputMobile.setValue("");
                if (errorStrip) errorStrip.setVisible(false);

                if (existingQrImage) {
                    handler._showQR(existingQrImage, existingQrUrl);
                } else {
                    var assignForm = _byId("assignForm");
                    var qrSection = _byId("qrSection");
                    var btnAssign = _byId("btnAssign");
                    if (assignForm) assignForm.setVisible(true);
                    if (qrSection) qrSection.setVisible(false);
                    if (btnAssign) { btnAssign.setVisible(true); btnAssign.setEnabled(true); }
                }
                oDialog.open();
            });
        },

        onAssign: function () {
            var inputMobile = _byId("inputMobile");
            var inputTruck = _byId("inputTruckReg");
            var mobile = inputMobile ? inputMobile.getValue().trim() : "";
            var truck = inputTruck ? inputTruck.getValue().trim() : null;

            if (!mobile) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText("Mobile Number is required."); strip.setVisible(true); }
                return;
            }

            var btnAssign = _byId("btnAssign");
            if (btnAssign) btnAssign.setEnabled(false);

            fetch("/odata/v4/tracking/assignDriver", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa("alice:alice")
                },
                body: JSON.stringify({
                    deliveryDoc: _deliveryDoc,
                    mobileNumber: mobile,
                    truckRegistration: truck || null
                })
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        var msg = (data && data.error && data.error.message) || "Assignment failed";
                        throw new Error(msg);
                    }
                    return data;
                });
            }).then(function (assignment) {
                handler._showQR(assignment.QRCodeImage, assignment.QRCodeUrl);
            }).catch(function (err) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText(err.message || "Failed to assign driver"); strip.setVisible(true); }
                if (btnAssign) btnAssign.setEnabled(true);
            });
        },

        onCloseDialog: function () {
            if (_dialog) _dialog.close();
        },

        _showQR: function (qrImageBase64, qrUrl) {
            var assignForm = _byId("assignForm");
            var btnAssign = _byId("btnAssign");
            var qrSection = _byId("qrSection");
            var htmlCtrl = _byId("qrImageHtml");

            if (assignForm) assignForm.setVisible(false);
            if (btnAssign) btnAssign.setVisible(false);
            if (qrSection) qrSection.setVisible(true);
            if (htmlCtrl) {
                var fullUrl = qrUrl ? (window.location.origin + qrUrl) : "";
                var linkHtml = fullUrl
                    ? '<p style="margin:8px 0 0;font-size:0.8rem;word-break:break-all">' +
                      '<a href="' + fullUrl + '" target="_blank" style="color:#0a6ed1">' + fullUrl + '</a></p>'
                    : "";
                htmlCtrl.setContent(
                    '<div style="text-align:center;padding:8px">' +
                    '<img src="' + qrImageBase64 + '" style="max-width:220px;display:block;margin:0 auto;" alt="QR Code"/>' +
                    linkHtml +
                    '</div>'
                );
            }
        },

        _getDialog: function () {
            if (_dialog) return Promise.resolve(_dialog);
            return Fragment.load({
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
