#!/bin/bash
# Cloud Foundry Subaccount/Space Switcher

echo "=== Cloud Foundry Target Switcher ==="
echo ""
echo "Current Target:"
cf target
echo ""
echo "Available Options:"
echo "1. Login and select org/space interactively"
echo "2. List all orgs and spaces"
echo "3. Switch to specific org/space"
echo "4. Exit"
echo ""
read -p "Choose option (1-4): " choice

case $choice in
  1)
    echo "Logging in with SSO..."
    cf login --sso
    ;;
  2)
    echo "Available Organizations:"
    cf orgs
    echo ""
    echo "Available Spaces in current org:"
    cf spaces
    ;;
  3)
    read -p "Enter organization name: " org
    read -p "Enter space name: " space
    echo "Switching to org: $org, space: $space"
    cf target -o "$org" -s "$space"
    ;;
  4)
    echo "Exiting..."
    exit 0
    ;;
  *)
    echo "Invalid option"
    exit 1
    ;;
esac

echo ""
echo "New Target:"
cf target
