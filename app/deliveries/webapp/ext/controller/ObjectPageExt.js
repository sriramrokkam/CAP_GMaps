sap.ui.define([
    "sap/fe/core/PageController",
    "sap/m/MessageToast"
], function (PageController, MessageToast) {
    "use strict";

    return PageController.extend("ewm.deliveries.ext.controller.ObjectPageExt", {

        onAssignDriver: function (oEvent) {
            const oCtx = this.getView().getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }
            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }

            sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                DriverAssign.openDialog(deliveryDoc, null);
            });
        },

        onShowQR: function (oEvent) {
            const oCtx = this.getView().getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }
            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) return;

            fetch("/odata/v4/tracking/getQRCode", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa("alice:alice")
                },
                body: JSON.stringify({ deliveryDoc })
            }).then(r => r.json()).then(data => {
                if (!data || !data.QRCodeImage) {
                    MessageToast.show("No active assignment found for this delivery.");
                    return;
                }
                sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                    DriverAssign.openDialog(deliveryDoc, data.QRCodeImage);
                });
            }).catch(() => {
                MessageToast.show("Failed to retrieve QR code.");
            });
        }
    });
});
