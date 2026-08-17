/**
 * Private network CIDR blocks (RFC 1918)
 * Used for internal on-premises network access
 */
export const ON_PREM_INTERNAL_CIDRS = [
    '10.236.0.0/14',
    '172.28.34.0/23',
    '10.162.0.0/16',
    '10.141.0.0/16',
    '10.228.0.0/14',
    '172.26.34.0/23',
    '172.28.162.0/23',
    '10.226.0.0/16',
    '172.26.162.0/23',
    '10.78.0.0/16',
    '10.76.0.0/16',
];

/**
 * AWS internal IP ranges for EKS cluster endpoint access
 * Includes private network ranges and AWS service endpoints
 * Used to restrict EKS API server access to internal networks only
 */
export const AWS_INTERNAL_CIDRS = [
    // Private network ranges (RFC 1918)
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
];

export const ON_PREM_EXTERNAL_CIDRS = [
    // AP-JP-TYO-1
    '18.176.3.13/32',
    '54.178.9.203/32',
    // Cambridge
    '50.232.171.176/29',
    '67.208.185.48/29',
    '185.172.188.104/29',
    // Frankfurt
    '3.64.42.11/32',
    '79.191.136.84/32',
    // Norwood
    '50.226.100.24/29',
    '69.46.224.144/28',
    '185.172.189.80/28',
    '185.172.189.206/31',
    // Warsaw
    '82.214.175.142/32',
    '212.221.68.58/32',
    // Others
    '50.223.15.40/29',
    '50.225.165.88/29',
    '50.235.10.0/28',
    '185.172.189.64/28',
    '185.172.189.200/31',
    '185.172.189.202/31',
];
