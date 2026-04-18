sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/Item"
], function (MessageToast, Fragment, JSONModel, Item) {
    "use strict";

    var _dialog      = null;
    var _deliveryDoc = null;
    var _drivers     = [];

    function _byId(sId) {
        return Fragment.byId("driverAssignFrag", sId);
    }

    var handler = {

        openDialog: function (deliveryDoc, existingQrImage) {
            _deliveryDoc = deliveryDoc;
            handler._getDialog().then(function (oDialog) {
                handler._resetForm();
                if (existingQrImage) {
                    handler._showQR(existingQrImage);
                } else {
                    var assignForm = _byId("assignForm");
                    var qrSection  = _byId("qrSection");
                    var btnAssign  = _byId("btnAssign");
                    if (assignForm) assignForm.setVisible(true);
                    if (qrSection)  qrSection.setVisible(false);
                    if (btnAssign)  { btnAssign.setVisible(true); btnAssign.setEnabled(true); }
                }
                handler._loadDrivers();
                oDialog.open();
            });
        },

        _resetForm: function () {
            var fields = ["inputMobile", "inputDriverName", "inputTruckReg", "assignErrorStrip"];
            fields.forEach(function (id) {
                var el = _byId(id);
                if (!el) return;
                if (id === "assignErrorStrip") el.setVisible(false);
                else if (el.setValue) el.setValue("");
                else if (el.clearSelection) el.clearSelection();
            });
        },

        _loadDrivers: function () {
            fetch("/odata/v4/tracking/Driver?$select=MobileNumber,DriverName,TruckRegistration&$filter=IsActive eq true&$orderby=DriverName", {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(function (res) { return res.json(); })
            .then(function (data) {
                _drivers = (data && data.value) || [];
                var oCombo = _byId("inputMobile");
                if (!oCombo) return;
                oCombo.destroyItems();
                _drivers.forEach(function (d) {
                    oCombo.addItem(new Item({
                        key:  d.MobileNumber,
                        text: d.MobileNumber + (d.DriverName ? " — " + d.DriverName : "")
                    }));
                });
            }).catch(function () { /* value help is best-effort */ });
        },

        onDriverSelect: function (oEvent) {
            var mobile  = oEvent.getParameter("selectedItem") && oEvent.getParameter("selectedItem").getKey();
            var driver  = _drivers.find(function (d) { return d.MobileNumber === mobile; });
            if (!driver) return;
            var inputName  = _byId("inputDriverName");
            var inputTruck = _byId("inputTruckReg");
            if (inputName  && driver.DriverName)        inputName.setValue(driver.DriverName);
            if (inputTruck && driver.TruckRegistration) inputTruck.setValue(driver.TruckRegistration);
        },

        onAssign: function () {
            var oCombo   = _byId("inputMobile");
            var mobile   = oCombo ? (oCombo.getValue ? oCombo.getValue().trim() : "") : "";
            var name     = _byId("inputDriverName") ? _byId("inputDriverName").getValue().trim() : "";
            var truck    = _byId("inputTruckReg")   ? _byId("inputTruckReg").getValue().trim()   : "";

            if (!mobile) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText("Mobile Number is required."); strip.setVisible(true); }
                return;
            }

            var btnAssign = _byId("btnAssign");
            if (btnAssign) btnAssign.setEnabled(false);

            fetch("/odata/v4/tracking/assignDriver", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Basic " + btoa("alice:alice") },
                body:    JSON.stringify({
                    deliveryDoc:       _deliveryDoc,
                    mobileNumber:      mobile,
                    truckRegistration: truck || null,
                    driverName:        name || null
                })
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw new Error((data && data.error && data.error.message) || "Assignment failed");
                    return data;
                });
            }).then(function (assignment) {
                handler._showQR(assignment.QRCodeImage);
            }).catch(function (err) {
                var strip = _byId("assignErrorStrip");
                if (strip) { strip.setText(err.message || "Failed to assign driver"); strip.setVisible(true); }
                if (btnAssign) btnAssign.setEnabled(true);
            });
        },

        _showQR: function (base64Image) {
            var assignForm = _byId("assignForm");
            var qrSection  = _byId("qrSection");
            var btnAssign  = _byId("btnAssign");
            var qrHtml     = _byId("qrImageHtml");
            if (assignForm) assignForm.setVisible(false);
            if (qrSection)  qrSection.setVisible(true);
            if (btnAssign)  btnAssign.setVisible(false);
            if (qrHtml && base64Image)
                qrHtml.setContent('<img src="' + base64Image + '" style="width:200px;height:200px;"/>');
        },

        onCloseDialog: function () {
            handler._getDialog().then(function (d) { d.close(); });
        },

        _getDialog: function () {
            if (_dialog) return Promise.resolve(_dialog);
            return Fragment.load({
                id:         "driverAssignFrag",
                name:       "ewm.deliveries.ext.fragment.DriverAssign",
                controller: handler
            }).then(function (oDialog) {
                _dialog = oDialog;
                return oDialog;
            });
        }
    };

    return handler;
});
